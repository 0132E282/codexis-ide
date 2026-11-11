//! Ollama as a coding agent: the Claude CLI runs the turn, with its API pointed at the local Ollama server, so the model gets the same tools (read, edit, shell) as Claude.

use super::{AgentCli, ClaudeAgent, Event, TurnOptions};
use crate::background::BackgroundChange;
use crate::cli::{CliKind, Environment};

/// Where the local Ollama server answers the Anthropic Messages API.
const OLLAMA_URL: &str = "http://localhost:11434";

pub struct OllamaAgent;

impl AgentCli for OllamaAgent {
    fn kind(&self) -> CliKind {
        CliKind::Ollama
    }

    fn program(&self) -> &'static str {
        CliKind::Claude.program()
    }

    fn turn_args(&self, options: &TurnOptions<'_>) -> Vec<String> {
        ClaudeAgent.turn_args(options)
    }

    fn parse_line(&self, line: &str) -> Vec<Event> {
        ClaudeAgent.parse_line(line)
    }

    fn background_change(&self, line: &str) -> Option<BackgroundChange> {
        ClaudeAgent.background_change(line)
    }

    fn supports_ask_mode(&self) -> bool {
        true
    }

    fn turn_environment(&self, _api_keys: Environment, agent_team: bool) -> Environment {
        // * The saved Anthropic keys are not passed: the requests go to the local server, which needs no account.
        let mut environment = ClaudeAgent.turn_environment(Vec::new(), agent_team);

        environment.extend([
            ("ANTHROPIC_BASE_URL", OLLAMA_URL.to_string()),
            ("ANTHROPIC_AUTH_TOKEN", "ollama".to_string()),
            ("ANTHROPIC_API_KEY", String::new()),
            ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1".to_string()),
        ]);

        environment
    }
}

#[cfg(test)]
#[path = "../../tests/unit/agent_ollama.rs"]
mod tests;
