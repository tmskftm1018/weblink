"""Run a student's project with the built-in, network-isolated API client."""

import runpy
import sys

sys.path.insert(0, "/opt/weblink/lib")
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
