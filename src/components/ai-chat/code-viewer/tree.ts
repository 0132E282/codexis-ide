export type TreeNode = {
    name: string;
    path: string;
    children: TreeNode[] | null;
};

// * Folders first, then files, each alphabetically.
export function buildTree(paths: string[]): TreeNode[] {
    const root: TreeNode = { name: '', path: '', children: [] };

    for (const path of paths) {
        let node = root;
        const parts = path.split('/');

        parts.forEach((name, index) => {
            const isFile = index === parts.length - 1;
            const nodePath = parts.slice(0, index + 1).join('/');
            let child = node.children?.find((item) => item.name === name);

            if (!child) {
                child = { name, path: nodePath, children: isFile ? null : [] };
                node.children?.push(child);
            }

            node = child;
        });
    }

    const sort = (nodes: TreeNode[]) => {
        nodes.sort(
            (a, b) =>
                Number(b.children !== null) - Number(a.children !== null) ||
                a.name.localeCompare(b.name),
        );
        nodes.forEach((node) => node.children && sort(node.children));
    };

    sort(root.children ?? []);

    return root.children ?? [];
}

/** * Every folder that holds at least one of the paths (all the way up to the root). */
export function parentDirectories(paths: Iterable<string>): Set<string> {
    const directories = new Set<string>();

    for (const path of paths) {
        const parts = path.split('/');

        parts
            .slice(0, -1)
            .forEach((_part, index) =>
                directories.add(parts.slice(0, index + 1).join('/')),
            );
    }

    return directories;
}
