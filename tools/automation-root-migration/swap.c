#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  struct stat source, destination;
  char target[PATH_MAX];
  if (argc != 3 || lstat(argv[1], &source) || lstat(argv[2], &destination) ||
      !S_ISDIR(source.st_mode) || !S_ISLNK(destination.st_mode) || source.st_dev != destination.st_dev) {
    fprintf(stderr, "Expected one real directory and one same-volume symlink\n");
    return 2;
  }
  ssize_t length = readlink(argv[2], target, sizeof(target) - 1);
  if (length < 0) return 3;
  target[length] = '\0';
  const char *basename = strrchr(argv[2], '/');
  if (!basename || strcmp(target, basename + 1)) {
    fprintf(stderr, "Destination symlink must name its future directory\n");
    return 4;
  }
  if (renamex_np(argv[1], argv[2], RENAME_SWAP)) {
    fprintf(stderr, "Atomic swap failed (errno=%d)\n", errno);
    return 5;
  }
  return 0;
}
