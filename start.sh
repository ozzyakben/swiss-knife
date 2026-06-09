#!/usr/bin/env bash
# Legacy launcher — superseded by ./swiss (up|down|status|doctor).
exec "$(cd "$(dirname "$0")" && pwd)/swiss" up
