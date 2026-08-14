#!/bin/sh
# Builds the WZ→NX converter (ryantpayton/NoLifeWzToNx, AGPL-3.0) for macOS.
# Usage: ./build-wz2nx.sh  → produces ./wz2nx next to this script.
# Convert: ./wz2nx client <file.wz> → <file.nx> in the same directory.
set -e
cd "$(dirname "$0")"
rm -rf wz2nx-src
git clone --depth 1 https://github.com/ryantpayton/NoLifeWzToNx.git wz2nx-src
cd wz2nx-src
# std::experimental::filesystem predates macOS clang's C++17
sed -i '' 's/namespace sys = std::experimental::filesystem;/namespace sys = std::filesystem;/' NoLifeWzToNx.cpp
clang++ -std=c++17 -O2 -Wno-deprecated-declarations -o ../wz2nx \
  NoLifeWzToNx.cpp Keys.cpp includes/libsquish/*.cpp \
  -Iincludes/libsquish \
  -I"$(brew --prefix lz4)/include" -L"$(brew --prefix lz4)/lib" -llz4 -lz
cd .. && rm -rf wz2nx-src
echo "built: $(pwd)/wz2nx"
