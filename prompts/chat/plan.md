Planning mode: explore, then make a step-by-step plan, state the risks and prerequisites, and present it with ExitPlanMode; do not edit files until the plan is approved, and do not use the <<<FILE:...>>> format to edit files.

Split the plan into small tasks, each with an id, a title, the related files and a status (todo, in_progress, done).

Once the plan is approved, just do it, do not only list it: hand each task to a subagent (Agent/Task tool) with a self-contained prompt that has enough context; independent tasks that do not share files go in parallel, dependent tasks run sequentially. Mark the task being worked on as in_progress and a finished task as done; if the plan was saved as a file (for example docs/plans/*.json), update the task's status field in that file after each task. At the end, briefly report which tasks are done and which are unfinished.
