cmake_minimum_required(VERSION 3.24)
if(CMAKE_BINARY_DIR STREQUAL CMAKE_SOURCE_DIR)
  message(FATAL_ERROR "Use an out-of-source build directory.")
endif()
project(CaneCpp VERSION 0.1.0 LANGUAGES CXX)
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/toolchain.json" CONTENT
  "{\"compilerId\":\"${CMAKE_CXX_COMPILER_ID}\",\"compilerVersion\":\"${CMAKE_CXX_COMPILER_VERSION}\",\"compiler\":\"${CMAKE_CXX_COMPILER}\",\"generator\":\"${CMAKE_GENERATOR}\"}\n")
# A public checkout contains only Core and adapter source. Local development
# checkouts may additionally provide tests without making them a build dependency.
set(CANE_LOCAL_TESTS_AVAILABLE OFF)
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/core/CMakeLists.txt" AND
   EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/tests/conformance/CMakeLists.txt")
  set(CANE_LOCAL_TESTS_AVAILABLE ON)
endif()
option(BUILD_TESTING "Build the optional local development tests" ${CANE_LOCAL_TESTS_AVAILABLE})
add_subdirectory(cane-core)
if(BUILD_TESTING)
  if(NOT CANE_LOCAL_TESTS_AVAILABLE)
    message(FATAL_ERROR "Development tests are not included. Configure with -DBUILD_TESTING=OFF.")
  endif()
  include(CTest)
  add_subdirectory(tests/conformance cane-conformance)
  add_subdirectory(tests/core cane-tests)
endif()
