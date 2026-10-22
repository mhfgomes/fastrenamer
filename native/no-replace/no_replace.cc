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
  std::string paths[2];
  for (int i = 0; i < 2; ++i) {
    size_t length;
    if (napi_get_value_string_utf8(env, args[i], nullptr, 0, &length) != napi_ok) {
      napi_throw_type_error(env, nullptr, "Expected string paths");
      return nullptr;
    }
    std::vector<char> buffer(length + 1);
    napi_get_value_string_utf8(env, args[i], buffer.data(), buffer.size(), &length);
    paths[i].assign(buffer.data(), length);
    if (paths[i].find('\0') != std::string::npos) {
      napi_throw_type_error(env, nullptr, "NUL in path");
      return nullptr;
    }
  }
  const char* code = "ENOTSUP";
  std::string message = "Atomic no-replace rename is unsupported";
  bool success = false;
#if defined(_WIN32)
  std::wstring wide[2];
  for (int i = 0; i < 2; ++i) {
    int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, paths[i].c_str(), -1, nullptr, 0);
    if (!length) {
      napi_throw_error(env, "EINVAL", "Invalid UTF-8 path");
      return nullptr;
    }
    std::vector<wchar_t> buffer(length);
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, paths[i].c_str(), -1, buffer.data(), length);
    wide[i] = buffer.data();
  }
  // No REPLACE_EXISTING and no COPY_ALLOWED (cross-volume moves must fail).
  success = MoveFileExW(wide[0].c_str(), wide[1].c_str(), 0) != 0;
  if (!success) {
    DWORD error = GetLastError();
    code = (error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS) ? "EEXIST" : "EIO";
    message = "Atomic no-replace rename failed (Windows error " + std::to_string(error) + ")";
  }
#else
  int result = -1;
#if defined(__APPLE__)
  result = renamex_np(paths[0].c_str(), paths[1].c_str(), RENAME_EXCL);
#elif defined(__linux__) && defined(SYS_renameat2)
  result = syscall(SYS_renameat2, AT_FDCWD, paths[0].c_str(), AT_FDCWD, paths[1].c_str(), 1 /* RENAME_NOREPLACE */);
#else
  errno = ENOTSUP;
#endif
  success = result == 0;
  if (!success) {
    int error = errno;
    code = error == EEXIST ? "EEXIST" :
      (error == ENOSYS || error == EINVAL || error == ENOTSUP) ? "ENOTSUP" : "EIO";
    message = std::string("Atomic no-replace rename failed: ") + strerror(error);
  }
#endif
  if (!success) {
    napi_throw_error(env, code, message.c_str());
    return nullptr;
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "renameNoReplace", NAPI_AUTO_LENGTH, Move, nullptr, &fn);
  napi_set_named_property(env, exports, "renameNoReplace", fn);
  return exports;
}
