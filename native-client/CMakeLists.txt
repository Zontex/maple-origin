cmake_minimum_required(VERSION 3.14)
project(OpenStory)

set(CMAKE_CXX_STANDARD 17)

file(GLOB_RECURSE SOURCE_FILES
            "src/*.h"
            "src/*.cpp"
            "src/*/*.cpp"
            "src/*/*.h"
    )
# Embed the Windows app/window icon (Explorer exe icon + GLFW window icon).
if(WIN32)
    list(APPEND SOURCE_FILES "${CMAKE_SOURCE_DIR}/resource/OpenStory.rc")
endif(WIN32)

add_executable(OpenStory ${SOURCE_FILES})

set_target_properties(OpenStory PROPERTIES
                      RUNTIME_OUTPUT_DIRECTORY_DEBUG ${CMAKE_SOURCE_DIR}/wz
                      RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_SOURCE_DIR}/wz
)

# Emit a PDB for optimized Release builds so crash logs (CrashLog.cpp) resolve to
# real function names + line numbers instead of raw addresses.
if(MSVC)
    target_compile_options(OpenStory PRIVATE $<$<CONFIG:Release>:/Zi>)
    target_link_options(OpenStory PRIVATE $<$<CONFIG:Release>:/DEBUG>)
endif()

# ADD_CUSTOM_COMMAND(TARGET OpenStory POST_BUILD
#                 COMMAND copy \"${CMAKE_SOURCE_DIR}\vendor\bass24\x64\bass.dll\"  \"${RUNTIME_OUTPUT_DIRECTORY_DEBUG}/\"
#                 COMMENT "copying dlls …"
#                 )


find_package(OpenGL REQUIRED)
TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${OPENGL_INCLUDE_DIRS})
target_link_libraries(OpenStory ${OPENGL_LIBRARIES})


if(WIN32)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/stb)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/freetype/include)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/glew-2.1.0/include/GL)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/bass24/c)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/glfw-3.3.2.bin.WIN32/include/GLFW)

    # Build NoLifeNx (and lz4) from source instead of the stale prebuilt
    # NoLifeNx.lib, so fixes to the bitmap/node code take effect on a normal
    # rebuild. lz4.c is compiled with MSVC here (the bundled liblz4_static.lib is
    # a MinGW build and won't link against MSVC).
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/includes/lz4_v1_8_2_win64/include)
    target_sources(OpenStory PRIVATE
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/audio.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/bitmap.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/file.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/node.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/nx.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/includes/lz4_v1_8_2_win64/lz4.c)

    target_link_libraries(OpenStory ${CMAKE_SOURCE_DIR}/vendor/freetype/win64/freetype.lib)
    target_link_libraries(OpenStory ${CMAKE_SOURCE_DIR}/vendor/bass24/c/x64/bass.lib)
    target_link_libraries(OpenStory ${CMAKE_SOURCE_DIR}/vendor/glew-2.1.0/lib/Release/x64/glew32s.lib)
    target_link_libraries(OpenStory ${CMAKE_SOURCE_DIR}/vendor/glfw-3.3.2.bin.WIN64/lib-vc2019/glfw3.lib)
    target_link_libraries(OpenStory Iphlpapi.lib)
endif(WIN32)


if(APPLE)
    # macOS build for the MapleWeb native client (M1: desktop proof).
    # Deps come from Homebrew (works for both /usr/local and /opt/homebrew).
    execute_process(COMMAND brew --prefix OUTPUT_VARIABLE HOMEBREW_PREFIX
                    OUTPUT_STRIP_TRAILING_WHITESPACE)

    # The codebase uses flat includes (<glew.h>, <glfw3.h>) — point straight
    # into the GL/GLFW include dirs like the WIN32 block does.
    target_include_directories(OpenStory PUBLIC
        ${HOMEBREW_PREFIX}/include
        ${HOMEBREW_PREFIX}/include/GL
        ${HOMEBREW_PREFIX}/include/GLFW
        ${HOMEBREW_PREFIX}/include/freetype2
        ${HOMEBREW_PREFIX}/opt/asio/include
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx
        ${CMAKE_SOURCE_DIR}/vendor/stb
    )

    # NoLifeNx from vendored source (same as WIN32); lz4 from Homebrew
    target_sources(OpenStory PRIVATE
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/audio.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/bitmap.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/file.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/node.cpp
        ${CMAKE_SOURCE_DIR}/vendor/NoLifeNx/nlnx/nx.cpp
    )

    find_library(COCOA_FW Cocoa)
    find_library(IOKIT_FW IOKit)
    target_link_libraries(OpenStory
        ${HOMEBREW_PREFIX}/lib/libglfw.dylib
        ${HOMEBREW_PREFIX}/lib/libGLEW.dylib
        ${HOMEBREW_PREFIX}/lib/libfreetype.dylib
        ${HOMEBREW_PREFIX}/lib/liblz4.dylib
        ${COCOA_FW} ${IOKIT_FW}
    )

    # Legacy GL 2.1 + GLSL 120 path — deprecated on macOS but fully functional
    target_compile_definitions(OpenStory PRIVATE
        GL_SILENCE_DEPRECATION
        USE_ASIO          # SocketAsio compiles on POSIX; replaced by WS in Phase 1
        MW_STUB_AUDIO     # BASS is Windows-only here; audio is a no-op for M1
    )
elseif(UNIX)
    target_link_libraries(OpenStory ${PROJECT_SOURCE_DIR}/libs/NoLifeNx/nlnx/build/libNoLifeNx.a)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/NoLifeNx)
    target_link_libraries(OpenStory ${PROJECT_SOURCE_DIR}/libs/lz4/lib/liblz4.a)

    INCLUDE(FindFreetype)
    IF(NOT FREETYPE_FOUND)
        FIND_LIBRARY(FREETYPE_LIBRARIES NAMES libfreetype freetype.dll PATHS "./libs/MacOS" "./libs/Windows" DOC "Freetype library")
        FIND_PATH(FREETYPE_INCLUDE_DIRS ftbuild.h "./includes" DOC "Freetype includes")
    ENDIF(NOT FREETYPE_FOUND)
    INCLUDE_DIRECTORIES(${FREETYPE_INCLUDE_DIRS})
    TARGET_LINK_LIBRARIES(OpenStory ${FREETYPE_LIBRARIES})

    TARGET_LINK_LIBRARIES(OpenStory ${PROJECT_SOURCE_DIR}/libs/glad/build/libglad.a)
    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/glad/build/include)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/glfw/include)
    TARGET_LINK_LIBRARIES(OpenStory ${PROJECT_SOURCE_DIR}/libs/glfw/build/src/libglfw3.a)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/openal-soft/include)
    TARGET_LINK_LIBRARIES(OpenStory ${PROJECT_SOURCE_DIR}/libs/openal-soft/build/libopenal.so)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/alure/include)
    TARGET_LINK_LIBRARIES(OpenStory ${PROJECT_SOURCE_DIR}/libs/alure/build/libalure2.so)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/stb)

    TARGET_INCLUDE_DIRECTORIES(OpenStory PUBLIC ${PROJECT_SOURCE_DIR}/libs/asio/asio/include)
    target_link_libraries(OpenStory X11)
    target_link_libraries(OpenStory dl)
    target_link_libraries(OpenStory pthread)
endif(UNIX)