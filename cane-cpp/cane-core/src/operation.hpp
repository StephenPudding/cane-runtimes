#pragma once
#include "cane/error.hpp"
#include <new>

namespace cane::detail {
template<class F> decltype(auto) operation(const char* name, F&& body) {
    try { return body(); }
    catch (const Error& e) { throw Error(e.code, name, e.what(), e.field, e.entity_id, e.detail); }
    catch (const std::bad_alloc&) { throw Error(ErrorCode::resource_limit, name, "Runtime allocation failed."); }
}
}
