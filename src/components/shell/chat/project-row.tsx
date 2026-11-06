import { ChevronDown, Laptop } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

/** The row under the message box: the projects the AI works in (this one, and others picked for the chat) and the worktree switch. */
export function ProjectRow({
    busy,
    projectName,
    otherProjects,
    extraRoots,
    onExtraRootsChange,
    worktree,
    onWorktreeChange,
}: {
    busy: boolean;
    /** Name of the project this chat belongs to. */
    projectName: string;
    /** Saved projects other than the one this chat belongs to. */
    otherProjects: { root: string; name: string }[];
    /** Folders of the other projects the AI may also work in. */
    extraRoots: string[];
    onExtraRootsChange: (roots: string[]) => void;
    /** Worktree mode: the AI works on its own git branch, in a copy of the project. */
    worktree: boolean;
    onWorktreeChange: (on: boolean) => void;
}) {
    const [projectSearch, setProjectSearch] = useState('');

    return (
        <div className="mt-1 flex items-center px-2 text-sm">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label="Chọn dự án đang làm"
                        title="Dự án AI làm việc: chọn thêm để làm nhiều dự án trong một chat"
                        className="max-w-full gap-1.5 text-muted-foreground"
                    >
                        <Laptop aria-hidden="true" />
                        <span className="truncate">
                            {projectName}
                            {extraRoots.length > 0
                                ? ` +${extraRoots.length}`
                                : ''}
                        </span>
                        <ChevronDown aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="start"
                    className="w-64"
                    onCloseAutoFocus={() => setProjectSearch('')}
                >
                    <div className="p-1">
                        <Input
                            value={projectSearch}
                            onChange={(event) =>
                                setProjectSearch(event.target.value)
                            }
                            onKeyDown={(event) => event.stopPropagation()}
                            aria-label="Tìm dự án"
                            placeholder="Tìm dự án..."
                        />
                    </div>
                    <DropdownMenuCheckboxItem checked disabled>
                        {projectName}
                    </DropdownMenuCheckboxItem>
                    {otherProjects.length === 0 && (
                        <DropdownMenuItem disabled>
                            Chưa có dự án khác. Thêm ở thanh bên.
                        </DropdownMenuItem>
                    )}
                    {otherProjects
                        .filter((other) =>
                            other.name
                                .toLowerCase()
                                .includes(projectSearch.trim().toLowerCase()),
                        )
                        .map((other) => (
                            <DropdownMenuCheckboxItem
                                key={other.root}
                                checked={extraRoots.includes(other.root)}
                                onSelect={(event) => event.preventDefault()}
                                onCheckedChange={(on) =>
                                    onExtraRootsChange(
                                        on
                                            ? [...extraRoots, other.root]
                                            : extraRoots.filter(
                                                  (root) => root !== other.root,
                                              ),
                                    )
                                }
                            >
                                {other.name}
                            </DropdownMenuCheckboxItem>
                        ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <label
                title="Chạy AI trên nhánh git riêng, trong bản sao của dự án; dự án gốc không bị đụng tới"
                className="ml-2 flex cursor-pointer items-center gap-1.5 text-muted-foreground"
            >
                <Checkbox
                    checked={worktree}
                    disabled={busy}
                    onCheckedChange={(on) => onWorktreeChange(on === true)}
                />
                Worktree
            </label>
        </div>
    );
}
