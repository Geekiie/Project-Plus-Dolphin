#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Build with portable LLVM and existing Visual Studio SDKs, without updating Visual Studio.

Fetch dependencies with git submodule update --init --recursive first.
Usage: python Standalone/build-clang.py --llvm C:/LLVM --vs "C:/Program Files/Microsoft Visual Studio/18/Community"
"""
import argparse
import os
import pathlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--llvm', required=True, type=pathlib.Path)
parser.add_argument('--vs', required=True, type=pathlib.Path)
parser.add_argument('--parallel', default=8, type=int)
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parent.parent
logs = repo/'Standalone/logs'
logs.mkdir(exist_ok=True)
cmake = args.vs/'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'
ninja = args.vs/'Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe'
clang = args.llvm.resolve()/'bin/clang-cl.exe'
vcvars = args.vs/'VC/Auxiliary/Build/vcvars64.bat'
for tool in (cmake, ninja, clang, vcvars):
    if not tool.is_file(): parser.error(f'Missing tool: {tool}')
if not 1 <= args.parallel <= 64: parser.error('--parallel must be 1–64')
batch = logs/'compiler-env.bat'
batch.write_text(f'@echo off\ncall "{vcvars}" >nul\nset\n')
environment = subprocess.check_output(['cmd.exe','/d','/c',str(batch)], text=True)
env = os.environ.copy()
for line in environment.splitlines():
    if '=' in line and not line.startswith('='):
        key,value = line.split('=',1)
        env[key] = value
env['PATH'] = str(clang.parent) + ';' + env.get('Path', env.get('PATH',''))
env.pop('Path', None)
configure = [str(cmake),'-S','.', '-B','build/standalone-clang','-G','Ninja',f'-DCMAKE_MAKE_PROGRAM={ninja}',
             f'-DCMAKE_C_COMPILER={clang}',f'-DCMAKE_CXX_COMPILER={clang}', '-DCMAKE_BUILD_TYPE=Release',
             '-DENABLE_QT=OFF','-DENABLE_NOGUI=ON','-DENABLE_TESTS=ON','-DUSE_DISCORD_PRESENCE=OFF',
             '-DDOLPHIN_WARNINGS_AS_ERRORS=OFF',
             '-DUSE_MGBA=OFF','-DUSE_RETRO_ACHIEVEMENTS=OFF','-DENABLE_AUTOUPDATE=OFF',
             '-DORCA_VERSION=0.3.28','-DDISTRIBUTOR=ProjectPlusStandalone']
with (logs/'configure.log').open('w') as log:
    code = subprocess.call(configure, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
print('Configure exit', code, flush=True)
if code: raise SystemExit(code)
with (logs/'build.log').open('w') as log:
    code = subprocess.call([str(cmake),'--build','build/standalone-clang','--target','dolphin-nogui','dolphin-tool','tests',
                            '--parallel',str(args.parallel)], cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
print('Build exit', code, flush=True)
raise SystemExit(code)
