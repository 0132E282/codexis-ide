use super::*;

fn poisoned() -> TurnRegistry {
    let registry = TurnRegistry::default();

    std::thread::scope(|scope| {
        let _ = scope
            .spawn(|| {
                let _guard = registry.0.lock().unwrap();
                panic!("poison");
            })
            .join();
    });

    registry
}

#[test]
fn a_started_turn_has_a_responder_and_a_pid_once_spawned() {
    let registry = TurnRegistry::default();

    registry.start("run", Some(Responder::new())).unwrap();

    assert!(registry.responder("run").is_ok());
    assert_eq!(registry.pid("run"), Err("agent.turn_ended".to_string()));

    registry.set_pid("run", 42);

    assert_eq!(registry.pid("run"), Ok(42));
}

#[test]
fn a_turn_without_questions_or_a_finished_turn_is_ended() {
    let registry = TurnRegistry::default();

    registry.start("plain", None).unwrap();
    registry.start("done", Some(Responder::new())).unwrap();
    registry.finish("done");

    assert_eq!(
        registry.responder("plain").err().as_deref(),
        Some("agent.turn_ended")
    );
    assert_eq!(
        registry.responder("done").err().as_deref(),
        Some("agent.turn_ended")
    );
    assert_eq!(registry.pid("done"), Err("agent.turn_ended".to_string()));
}

#[test]
fn a_running_id_cannot_be_started_again_until_it_finishes() {
    let registry = TurnRegistry::default();

    registry.start("run-1", None).unwrap();
    registry.set_pid("run-1", 7);

    assert_eq!(
        registry.start("run-1", None),
        Err(validation::KEY_RUN_EXISTS.to_string())
    );
    assert_eq!(registry.pid("run-1"), Ok(7));

    registry.finish("run-1");

    assert!(registry.start("run-1", None).is_ok());
}

#[test]
fn a_stop_is_kept_for_the_relay_and_ends_a_process_that_starts_later() {
    let registry = TurnRegistry::default();

    registry.start("run-1", None).unwrap();

    assert!(!registry.is_stopped("run-1"));
    // * No process yet: nothing to kill, but the relay must not go on.
    assert_eq!(registry.request_stop("run-1"), Ok(None));
    assert!(registry.is_stopped("run-1"));
    // * A hop spawned after the stop is told to end at once.
    assert!(registry.set_pid("run-1", 9));
    assert_eq!(registry.request_stop("run-1"), Ok(Some(9)));

    registry.clear_pid("run-1");

    assert_eq!(registry.request_stop("run-1"), Ok(None));
    assert_eq!(
        registry.request_stop("gone"),
        Err("agent.turn_ended".to_string())
    );
    assert!(!registry.is_stopped("gone"));
}

#[test]
fn a_relayed_hop_never_asks_the_person() {
    assert_eq!(
        mode_for_hop(Some(agent::PLAN_MODE)),
        Some(agent::READ_ONLY_PLAN_MODE)
    );
    assert_eq!(mode_for_hop(Some(agent::ASK_MODE)), None);
    assert_eq!(mode_for_hop(Some("auto")), Some("auto"));
    assert_eq!(mode_for_hop(None), None);
}

#[test]
fn a_poisoned_registry_gives_the_reply_and_stop_keys() {
    let registry = poisoned();

    assert_eq!(
        registry.responder("run").err().as_deref(),
        Some("agent.reply_failed")
    );
    assert_eq!(registry.pid("run"), Err("agent.stop_failed".to_string()));
}
