//! Everything about plans: the plan the agent writes while it works (`types`), how it is kept per chat (`store`),
//! how it is saved into the project (`project`), and the plan documents of the project's plans folder (`docs`).

pub mod docs;
pub mod project;
pub mod store;
pub mod types;
