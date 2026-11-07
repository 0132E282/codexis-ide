// * How long a turn started while another one is starting waits for that one's session id.
const SESSION_WAIT_MS = 3000;

/** Resolves once `ready()` is true (checked again at every `wake`) or after a few seconds, whichever comes first. */
export function waitForSession(
    waiters: Set<() => void>,
    ready: () => boolean,
): Promise<void> {
    if (ready()) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
        const finish = () => {
            clearTimeout(timer);
            waiters.delete(check);
            resolve();
        };
        const check = () => {
            if (ready()) {
                finish();
            }
        };
        const timer = setTimeout(finish, SESSION_WAIT_MS);

        waiters.add(check);
    });
}
