/** * Stand-in for the web app's axios `api`: the `/ai-chat/local/*` routes the copied components call are answered by Rust commands (`invoke`).
 * Failures are real AxiosErrors carrying `{ message }`, so the components' own error handling works unchanged.
 * A route without a command yet fails the same way, with a fixed message. */
import { invoke } from '@tauri-apps/api/core';
import { AxiosError } from 'axios';
import { mediaMime, readMedia } from '@/lib/media-file';

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

/** `root` names the project on the web; the IDE has one open project, so it is dropped. */
function without(body: Body, ...keys: string[]): Record<string, unknown> {
    const rest = { ...body };

    ['root', ...keys].forEach((key) => delete rest[key]);

    return rest;
}

async function call<T>(
    command: string,
    args?: Record<string, unknown>,
): Reply<T> {
    try {
        return { data: await invoke<T>(command, args) };
    } catch (caught) {
        throw failure(
            typeof caught === 'string' ? caught : 'Có lỗi xảy ra.',
            422,
        );
    }
}

function unwired(method: string, url: string): never {
    throw failure(`Chức năng này chưa có trong IDE (${method} ${url}).`, 501);
}

function path(url: string): string {
    return url.split('?')[0];
}

export const api = {
    get: <T = unknown>(url: string, config?: Params): Reply<T> => {
        const query = config?.params ?? {};

        switch (path(url)) {
            case '/ai-chat/local/tree':
                return call('workspace_tree');
            case '/ai-chat/local/file': {
                const mime = mediaMime(String(query.path ?? ''));

                if (mime !== null) {
                    return readMedia(String(query.path), mime)
                        .then((image) => ({
                            data: { path: query.path, image } as T,
                        }))
                        .catch((caught) => {
                            throw failure(
                                typeof caught === 'string'
                                    ? caught
                                    : 'Có lỗi xảy ra.',
                                422,
                            );
                        });
                }

                return call<{ content: string }>('workspace_read', {
                    path: query.path,
                }).then(({ data }) => ({
                    data: { path: query.path, content: data.content } as T,
                }));
            }
            case '/ai-chat/local/head':
                return call('local_head', { path: query.path });
            case '/ai-chat/local/changes':
                return call('local_changes');
            case '/ai-chat/local/branches':
                return call('local_branches');
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
                return call('local_discard', { path: data?.path });
            case '/ai-chat/local/commit':
                return call('local_commit', without(data));
            case '/ai-chat/local/commit-message':
                return call('local_commit_message');
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
            }).then(() => ({ data: { path: data?.path } as T }));
        }

        return Promise.reject(unwired('PUT', url));
    },
    delete: <T = unknown>(url: string, _config?: unknown): Reply<T> =>
        Promise.reject(unwired('DELETE', url)),
};
