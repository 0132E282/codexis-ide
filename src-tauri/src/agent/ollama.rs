//! The Ollama CLI as a stateless text chat agent.

use super::{AgentCli, Event, TurnOptions};
use crate::cli::CliKind;

pub struct OllamaAgent;

impl AgentCli for OllamaAgent {
    fn kind(&self) -> CliKind {
        CliKind::Ollama
    }

    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        options
            .model
            .map(|model| vec!["run".to_string(), model.to_string()])
            .unwrap_or_default()
    }

    fn parse_line(&self, line: &str) -> Vec<Event> {
        (!line.is_empty())
            .then(|| Event::Text(line.to_string()))
            .into_iter()
            .collect()
    }
}

#[cfg(test)]
#[path = "../../tests/unit/agent_ollama.rs"]
mod tests;
