#pragma once
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>

namespace cane {
enum class ErrorCode : std::uint32_t {
    invalid_argument = 1, invalid_utf8 = 2, invalid_json = 3, validation_failed = 4,
    not_found = 5, invalid_state = 6, unsupported_version = 7, resource_limit = 8,
    unsupported_feature = 9, missing_resource = 10, malformed_input = 11,
    non_finite = 12, missing_reference = 13, internal = 255
};

class Error final : public std::runtime_error {
public:
    ErrorCode code;
    std::string operation;
    std::optional<std::string> field;
    std::optional<std::string> entity_id;
    std::optional<std::string> detail;
    Error(ErrorCode error_code, std::string op, std::string message,
          std::optional<std::string> error_field = {}, std::optional<std::string> entity = {},
          std::optional<std::string> error_detail = {})
        : std::runtime_error(std::move(message)), code(error_code), operation(std::move(op)),
          field(std::move(error_field)), entity_id(std::move(entity)), detail(std::move(error_detail)) {}
};
}
