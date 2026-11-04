import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MouseEvent, UIEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type InputSelectOption = {
    value: string;
    label: string;
    /** * Sub-items of self-referencing resources, rendered indented under the parent. */
    children?: InputSelectOption[];
};

type FlatOption = InputSelectOption & { depth: number };

function flattenOptions(options: InputSelectOption[], depth = 0): FlatOption[] {
    return options.flatMap((option) => [
        { ...option, depth },
        ...(option.children ? flattenOptions(option.children, depth + 1) : []),
    ]);
}

type InputSelectSharedProps = {
    options: InputSelectOption[];
    placeholder?: string;
    className?: string;
    /** * Default: on when there are more than a few options. */
    searchable?: boolean;
    /** * Delegates search to the caller for server-side sources; omit for small static lists. */
    onSearchChange?: (term: string) => void;
    /** * Fires near the bottom of the list to load the next page. */
    onLoadMore?: () => void;
    loading?: boolean;
    disabled?: boolean;
};

export type InputSelectProps =
    | (InputSelectSharedProps & {
          multiple: true;
          value: string[];
          onChange: (value: string[]) => void;
      })
    | (InputSelectSharedProps & {
          multiple?: false;
          value: string | null;
          onChange: (value: string | null) => void;
      });

/** * Single and multi select in one (`multiple`); Popover-based because Radix Select can't hold multiple values. */
export function InputSelect(props: InputSelectProps) {
    const {
        options,
        placeholder = 'Chọn...',
        className,
        multiple,
        onSearchChange,
        onLoadMore,
        loading,
        disabled,
    } = props;
    // * A remote page's length says nothing about whether search is useful.
    const { searchable = !!onSearchChange || options.length > 6 } = props;
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');

    // * Tree options become selectable rows indented under their parent.
    const flatOptions = useMemo(() => flattenOptions(options), [options]);

    const selectedValues = multiple
        ? props.value
        : props.value
          ? [props.value]
          : [];
    const selectedOptions = flatOptions.filter((option) =>
        selectedValues.includes(option.value),
    );

    // * Server-searched lists must not be filtered again client-side (only the current page is loaded).
    const filteredOptions = useMemo(() => {
        if (onSearchChange || !search) {
            return flatOptions;
        }

        const term = search.toLowerCase();

        return flatOptions.filter((option) =>
            option.label.toLowerCase().includes(term),
        );
    }, [flatOptions, search, onSearchChange]);

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        if (!onLoadMore || loading) {
            return;
        }

        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;

        if (scrollHeight - scrollTop - clientHeight < 48) {
            onLoadMore();
        }
    };

    const toggle = (optionValue: string) => {
        if (multiple) {
            const next = selectedValues.includes(optionValue)
                ? selectedValues.filter((value) => value !== optionValue)
                : [...selectedValues, optionValue];

            props.onChange(next);

            return;
        }

        props.onChange(optionValue);
        setOpen(false);
    };

    const allFilteredSelected =
        filteredOptions.length > 0 &&
        filteredOptions.every((option) =>
            selectedValues.includes(option.value),
        );
    const someFilteredSelected =
        !allFilteredSelected &&
        filteredOptions.some((option) => selectedValues.includes(option.value));

    const toggleSelectAll = () => {
        if (!multiple) {
            return;
        }

        const filteredValues = filteredOptions.map((option) => option.value);

        props.onChange(
            allFilteredSelected
                ? selectedValues.filter(
                      (value) => !filteredValues.includes(value),
                  )
                : [...new Set([...selectedValues, ...filteredValues])],
        );
    };

    const clear = (event: MouseEvent) => {
        event.stopPropagation();
        setSearch('');

        if (multiple) {
            props.onChange([]);
        } else {
            props.onChange(null);
        }
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);

                if (!next) {
                    setSearch('');
                }
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        'h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal',
                        !selectedOptions.length && 'text-muted-foreground',
                        className,
                    )}
                >
                    <span className="flex flex-1 flex-wrap items-center gap-1 text-left">
                        {selectedOptions.length === 0 && placeholder}
                        {!multiple && selectedOptions[0]?.label}
                        {multiple &&
                            selectedOptions.map((option) => (
                                <Badge
                                    key={option.value}
                                    variant="secondary"
                                    className="gap-1 font-normal"
                                >
                                    {option.label}
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        className="hover:bg-muted-foreground/20 rounded-full"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            toggle(option.value);
                                        }}
                                    >
                                        <X className="size-3" />
                                    </span>
                                </Badge>
                            ))}
                    </span>
                    {selectedOptions.length > 0 && (
                        <span
                            role="button"
                            tabIndex={-1}
                            className="hover:bg-muted-foreground/20 rounded-full p-0.5"
                            onClick={clear}
                        >
                            <X className="size-3.5" />
                        </span>
                    )}
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-(--radix-popover-trigger-width) p-1"
                align="start"
            >
                {searchable && (
                    <Input
                        autoFocus
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            onSearchChange?.(event.target.value);
                        }}
                        placeholder="Tìm kiếm..."
                        className="mb-1 h-8"
                    />
                )}

                {multiple && filteredOptions.length > 0 && (
                    <div className="mb-1 flex items-center gap-1 border-b pb-1">
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={toggleSelectAll}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    toggleSelectAll();
                                }
                            }}
                            className="hover:bg-accent hover:text-accent-foreground flex flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium"
                        >
                            <Checkbox
                                checked={
                                    someFilteredSelected
                                        ? 'indeterminate'
                                        : allFilteredSelected
                                }
                                className="pointer-events-none"
                            />
                            Chọn tất cả
                        </div>
                        <button
                            type="button"
                            onClick={() => props.onChange([])}
                            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-sm px-2 py-1.5 text-sm font-medium"
                        >
                            Xóa tất cả
                        </button>
                    </div>
                )}

                <div
                    className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
                    onScroll={handleListScroll}
                >
                    {filteredOptions.length === 0 && !loading && (
                        <div className="text-muted-foreground px-2 py-1.5 text-sm">
                            Không có lựa chọn
                        </div>
                    )}
                    {filteredOptions.map((option) => {
                        const isSelected = selectedValues.includes(
                            option.value,
                        );

                        return (
                            <div
                                key={option.value}
                                role="button"
                                tabIndex={0}
                                onClick={() => toggle(option.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggle(option.value);
                                    }
                                }}
                                style={
                                    option.depth
                                        ? {
                                              paddingLeft: `${option.depth * 1.5 + 0.5}rem`,
                                          }
                                        : undefined
                                }
                                className="hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                            >
                                {/* * The "└" connector makes the parent/child relationship unambiguous. */}
                                {option.depth > 0 && (
                                    <span className="text-muted-foreground shrink-0">
                                        └
                                    </span>
                                )}
                                {multiple ? (
                                    <Checkbox
                                        checked={isSelected}
                                        className="pointer-events-none"
                                    />
                                ) : (
                                    <Check
                                        className={cn(
                                            'size-4 shrink-0',
                                            isSelected
                                                ? 'opacity-100'
                                                : 'opacity-0',
                                        )}
                                    />
                                )}
                                <span
                                    className={cn(
                                        option.depth > 0 &&
                                            'text-muted-foreground',
                                    )}
                                >
                                    {option.label}
                                </span>
                            </div>
                        );
                    })}
                    {loading && (
                        <div className="text-muted-foreground px-2 py-1.5 text-center text-sm">
                            Đang tải...
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
