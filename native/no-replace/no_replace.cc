#include <node_api.h>
#include <string>
#include <vector>
#include <cerrno>
#include <cstring>
#if defined(_WIN32)
#include <windows.h>
#elif defined(__APPLE__)
#include <stdio.h>
#elif defined(__linux__)
#include <fcntl.h>
#include <unistd.h>
#include <sys/syscall.h>
#endif

// Each invocation owns its paths and result until completion on the JS thread.
struct RenameWork {
  napi_async_work async;
  napi_deferred deferred;
  std::string paths[2];
  bool success = false;
  const char* code = "ENOTSUP";
  std::string message = "Atomic no-replace rename is unsupported";
};

// No Node-API calls here: the filesystem operation and its thread-local error
// capture run together on the worker pool, including on slow/network mounts.
static void Execute(napi_env, void* data) {
  auto* work = static_cast<RenameWork*>(data);
#if defined(_WIN32)
  std::wstring wide[2];
  for (int i = 0; i < 2; ++i) {
    int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, work->paths[i].c_str(), -1, nullptr, 0);
    if (!length) {
      work->code = "EINVAL";
      work->message = "Invalid UTF-8 path";
      return;
    }
    std::vector<wchar_t> buffer(length);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, work->paths[i].c_str(), -1, buffer.data(), length);
    wide[i] = buffer.data();
  }
  // No REPLACE_EXISTING and no COPY_ALLOWED (cross-volume moves must fail).
  work->success = MoveFileExW(wide[0].c_str(), wide[1].c_str(), 0) != 0;
  if (!work->success) {
    DWORD error = GetLastError();
    work->code = (error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS) ? "EEXIST" : "EIO";
    work->message = "Atomic no-replace rename failed (Windows error " + std::to_string(error) + ")";
  }
#else
  int result = -1;
#if defined(__APPLE__)
  result = renamex_np(work->paths[0].c_str(), work->paths[1].c_str(), RENAME_EXCL);
#elif defined(__linux__) && defined(SYS_renameat2)
  result = syscall(SYS_renameat2, AT_FDCWD, work->paths[0].c_str(), AT_FDCWD, work->paths[1].c_str(), 1 /* RENAME_NOREPLACE */);
#else
  errno = ENOTSUP;
#endif
  work->success = result == 0;
  if (!work->success) {
    int error = errno;
    work->code = error == EEXIST ? "EEXIST" :
      (error == ENOSYS || error == EINVAL || error == ENOTSUP) ? "ENOTSUP" : "EIO";
    work->message = std::string("Atomic no-replace rename failed: ") + strerror(error);
  }
#endif
}

static void Complete(napi_env env, napi_status status, void* data) {
  auto* work = static_cast<RenameWork*>(data);
  napi_value value;
  if (status == napi_ok && work->success) {
    napi_get_undefined(env, &value);
    napi_resolve_deferred(env, work->deferred, value);
  } else {
    napi_value code, message;
    napi_create_string_utf8(env, status == napi_ok ? work->code : "ECANCELED", NAPI_AUTO_LENGTH, &code);
    napi_create_string_utf8(env, status == napi_ok ? work->message.c_str() : "Atomic no-replace rename canceled", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, code, message, &value);
    napi_reject_deferred(env, work->deferred, value);
  }
  napi_delete_async_work(env, work->async);
  delete work;
}

// One kernel operation for both files and directories. Never emulate with rename,
// copy/delete, or link/unlink: those either clobber or change crash recovery semantics.
static napi_value Move(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 2) {
    napi_throw_type_error(env, nullptr, "Expected two paths");
    return nullptr;
  }
  auto* work = new RenameWork;
  for (int i = 0; i < 2; ++i) {
    size_t length;
    if (napi_get_value_string_utf8(env, args[i], nullptr, 0, &length) != napi_ok) {
      napi_throw_type_error(env, nullptr, "Expected string paths");
      delete work;
      return nullptr;
    }
    std::vector<char> buffer(length + 1);
    napi_get_value_string_utf8(env, args[i], buffer.data(), buffer.size(), &length);
    work->paths[i].assign(buffer.data(), length);
    if (work->paths[i].find('\0') != std::string::npos) {
      napi_throw_type_error(env, nullptr, "NUL in path");
      delete work;
      return nullptr;
    }
  }
  napi_value promise, name;
  napi_create_promise(env, &work->deferred, &promise);
  napi_create_string_utf8(env, "renameNoReplace", NAPI_AUTO_LENGTH, &name);
  napi_status status = napi_create_async_work(env, nullptr, name, Execute, Complete, work, &work->async);
  if (status == napi_ok) {
    status = napi_queue_async_work(env, work->async);
    if (status != napi_ok) napi_delete_async_work(env, work->async);
  }
  if (status != napi_ok) {
    napi_value message, error;
    napi_create_string_utf8(env, "Unable to queue atomic no-replace rename", NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, nullptr, message, &error);
    napi_reject_deferred(env, work->deferred, error);
    delete work;
  }
  return promise;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "renameNoReplace", NAPI_AUTO_LENGTH, Move, nullptr, &fn);
  napi_set_named_property(env, exports, "renameNoReplace", fn);
  return exports;
}
