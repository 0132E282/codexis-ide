/** * Stand-in for the web app's axios `api`: the `/ai-chat/local/*` routes the copied components call are answered by Rust commands (`invoke`).
 * Failures are real AxiosErrors carrying `{ message }`, so the components' own error handling works unchanged.
 * A route without a command yet fails the same way, with a fixed message. */
import { invoke } from '@/lib/invoke';
import { listen } from '@tauri-apps/api/event';
import { AxiosError } from 'axios';
import { mediaMime, readMedia } from '@/lib/media-file';
import { t } from '@/lib/i18n';

type Reply<T> = Promise<{ data: T }>;
type Params = { params?: Record<string, unknown> };
type Body = Record<string, unknown> | undefined;

function failure(message: string, status: number): AxiosError {
    return new AxiosError(message, String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: {} as never,
        data: { message },
    });
}

/** The project a call is for: the viewer sends the full path of its folder as `root`. */
function rootOf(source: Body | Record<string, unknown>): string | undefined {
    const root = source?.root;

    return typeof root === 'string' ? root : undefined;
}

async function call<T>(
    command: string,
    args?: Record<string, unknown>,
): Reply<T> {
    try {
        return { data: await invoke<T>(command, args) };
    } catch (caught) {
        throw failure(
            typeof caught === 'string'
                ? caught
                : t('common.something_went_wrong'),
            422,
        );
    }
}

function unwired(method: string, url: string): never {
    throw failure(t('api.this_feature_is_not', { method, url }), 501);
}

function path(url: string): string {
    return url.split('?')[0];
}

export const api = {
    get: <T = unknown>(url: string, config?: Params): Reply<T> => {
        const query = config?.params ?? {};

        switch (path(url)) {
            case '/ai-chat/local/tree':
                return call('workspace_tree', { root: rootOf(query) });
            case '/ai-chat/local/file': {
                const mime = mediaMime(String(query.path ?? ''));

                if (mime !== null) {
                    return readMedia(String(query.path), mime, rootOf(query))
                        .then((image) => ({
                            data: { path: query.path, image } as T,
                        }))
                        .catch((caught) => {
                            throw failure(
                                typeof caught === 'string'
                                    ? caught
                                    : t('common.something_went_wrong'),
                                422,
                            );
                        });
                }

                return call<{ content: string }>('workspace_read', {
                    path: query.path,
                    root: rootOf(query),
                }).then(({ data }) => ({
                    data: { path: query.path, content: data.content } as T,
                }));
            }
            case '/ai-chat/local/head':
                return call('local_head', {
                    path: query.path,
                    root: rootOf(query),
                });
            case '/ai-chat/local/changes':
                return call('local_changes', { root: rootOf(query) });
            case '/ai-chat/local/branches':
                return call('local_branches', { root: rootOf(query) });
            default:
                return Promise.reject(unwired('GET', url));
        }
    },
    post: <T = unknown>(
        url: string,
        data?: Body,
        _config?: unknown,
    ): Reply<T> => {
        switch (path(url)) {
            case '/ai-chat/local/discard':
                return call('local_discard', {
                    path: data?.path,
                    root: rootOf(data),
                });
            case '/ai-chat/local/commit':
                return call('local_commit', {
                    message: data?.message,
                    root: rootOf(data),
                });
            case '/ai-chat/local/rename':
                return call('workspace_rename', {
                    path: data?.path,
                    newName: data?.newName,
                    root: rootOf(data),
                });
            case '/ai-chat/local/format':
                return call('format_code', {
                    path: data?.path,
                    content: data?.content,
                    root: rootOf(data),
                });
            case '/ai-chat/local/commit-message':
                return call('local_commit_message', { root: rootOf(data) });
            case '/ai-chat/inline-ask':
                return call('inline_ask', {
                    root: rootOf(data),
                    path: data?.path,
                    startLine: data?.startLine,
                    endLine: data?.endLine,
                    text: data?.text,
                    question: data?.question,
                });
            default:
                return Promise.reject(unwired('POST', url));
        }
    },
    put: <T = unknown>(
        url: string,
        data?: Body,
        _config?: unknown,
    ): Reply<T> => {
        if (path(url) === '/ai-chat/local/file') {
            return call<unknown>('local_put_file', {
                path: data?.path,
                content: data?.content,
                root: rootOf(data),
            }).then(() => ({ data: { path: data?.path } as T }));
        }

        return Promise.reject(unwired('PUT', url));
    },
    delete: <T = unknown>(url: string, _config?: unknown): Reply<T> =>
        Promise.reject(unwired('DELETE', url)),
};

/** State of a background task, as the backend reports it. */
export type BackgroundTaskState = 'running' | 'done' | 'failed' | 'stopped';

/** One background task of a project: a shell command or a sub-agent (`kind`). */
export type BackgroundTask = {
    id: string;
    kind: 'shell' | 'subagent';
    label: string;
    state: BackgroundTaskState;
    /** Unix seconds. */
    startedAt: number;
    outputTail: string;
};

/** Background tasks: the Rust commands `background_list`, `background_stop`, `background_clear` (not in the backend until TASK-B04). */
export const backgroundApi = {
    list: (root: string) =>
        invoke<{ tasks: BackgroundTask[] }>('background_list', { root }),
    stop: (root: string, id: string) =>
        invoke<void>('background_stop', { root, id }),
    clear: (root: string) => invoke<void>('background_clear', { root }),
    /** Listens to the `kind: "background"` agent events (the table changed); `unlisten` is returned. */
    onChange: (handler: () => void) =>
        listen<{ kind: string }>('agent-event', ({ payload }) => {
            if (payload.kind === 'background') {
                handler();
            }
        }),
};
