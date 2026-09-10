#include "physics.hpp"
#include "solvers.hpp"

namespace cane::constraints {
void solve_constraints(Context& context, PhysicsStore& physics, const PhysicsStep& step, PhysicsBudget& budget, const animation::Sampling& sampling) {
    using K = animation::ConstraintKind;
    for (std::size_t i = 0; i < context.pose.model().constraints.size(); ++i) {
        switch (context.pose.model().constraints[i].kind) {
            case K::ik: solve_ik(context, i); break;
            case K::transform: solve_transform(context, i); break;
            case K::path: solve_path(context, i); break;
            case K::physics: solve_physics(context, i, physics, step, budget); break;
            case K::slider: solve_slider(context, i, sampling); break;
        }
    }
}
}
