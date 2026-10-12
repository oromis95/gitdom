#!/bin/sh
# GIT_ASKPASS and SSH_ASKPASS of the git commands GitDom runs: askpass.js, run by GitDom's own
# executable as Node. ELECTRON_RUN_AS_NODE is set here only, so hooks and editors started by git
# don't inherit it.
ELECTRON_RUN_AS_NODE=1 exec "$GITDOM_NODE" "$GITDOM_ASKPASS_SCRIPT" "$@"
