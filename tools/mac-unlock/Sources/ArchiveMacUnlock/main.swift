import MacUnlockKit
import Darwin

var limit = rlimit(rlim_cur: 0, rlim_max: 0)
setrlimit(RLIMIT_CORE, &limit)
exit(runArchiveMacUnlock(Array(CommandLine.arguments.dropFirst())))
