import {
    Copy,
    FolderOpen,
    MoreHorizontal,
    PencilLine,
    Trash2,
    Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Control, FieldValues } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { FilePickerDialog } from '@/components/file-manager/file-picker-dialog';
import {
    FileViewer,
    getFileName,
    getFileUrl,
    getRawFile,
} from '@/components/file-viewer';
import type { FileViewerValue } from '@/components/file-viewer';
import { RowActionsMenu } from '@/components/tables/row-actions-menu';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type AttachmentSource = 'system' | 'manager';

export interface AttachmentFieldProps {
    name: string;
    accept?: string;
    control?: Control<FieldValues>;
    fieldProps?: Record<string, unknown>;
    /** * Comma-separated sources: "system", "manager" or both (default). */
    source?: string;
    multiple?: boolean;
    size?: 'sm' | 'lg';
}

function parseSources(source?: string): AttachmentSource[] {
    if (!source) {
        return ['system', 'manager'];
    }

    const sources = source
        .split(',')
        .map((source) => source.trim())
        .filter(
            (source): source is AttachmentSource =>
                source === 'system' || source === 'manager',
        );

    return sources.length > 0 ? sources : ['system', 'manager'];
}

/** * Uses the alt text as display name; wraps raw File/string values into the metadata shape. */
function withDisplayName(
    value: FileViewerValue,
    displayName: string,
): FileViewerValue {
    const rawFile = getRawFile(value);

    if (rawFile) {
        return { file: rawFile, name: displayName, alt: displayName };
    }

    const url = getFileUrl(value);

    if (!url) {
        return value;
    }

    return { url, name: displayName, alt: displayName };
}

const BOX_SIZE_CLASS: Record<'sm' | 'lg', string> = {
    sm: 'size-16',
    lg: 'size-32',
};

function AttachmentBox({
    file,
    accept,
    sources,
    onSelect,
    onOpenManager,
    onChange,
    onClear,
    size = 'lg',
}: {
    file: FileViewerValue;
    accept?: string;
    sources: AttachmentSource[];
    onSelect: (file: File) => void;
    onOpenManager: () => void;
    onChange: (value: FileViewerValue) => void;
    onClear: () => void;
    size?: 'sm' | 'lg';
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const showSystem = sources.includes('system');
    const showManager = sources.includes('manager');
    const showUploadOptions = !file && showSystem && showManager;
    const url = getFileUrl(file);
    const boxSizeClass = BOX_SIZE_CLASS[size];

    const handleClick = () => {
        if (showManager) {
            onOpenManager();
        } else if (showSystem) {
            inputRef.current?.click();
        }
    };

    const handleRename = () => {
        const nextDisplayName = window.prompt(
            t('attachment_field.rename_image_also_used'),
            getFileName(file),
        );

        if (nextDisplayName) {
            onChange(withDisplayName(file, nextDisplayName));
        }
    };

    const handleCopyUrl = () => {
        if (url) {
            navigator.clipboard.writeText(url);
        }
    };

    type MenuAction =
        'upload-system' | 'upload-manager' | 'rename' | 'copy-url' | 'delete';

    type MenuOption = {
        key: MenuAction;
        label: string;
        icon: LucideIcon;
        show: boolean;
        disabled?: boolean;
        destructive?: boolean;
        separatorBefore?: boolean;
    };

    const menuOptions = (
        [
            {
                key: 'upload-system',
                label: t('common.upload_from_device'),
                icon: Upload,
                show: showUploadOptions,
            },
            {
                key: 'upload-manager',
                label: t('common.file_library'),
                icon: FolderOpen,
                show: showUploadOptions,
            },
            {
                key: 'rename',
                label: t('attachment_field.rename_image'),
                icon: PencilLine,
                show: !!file,
            },
            {
                key: 'copy-url',
                label: t('attachment_field.copy_url'),
                icon: Copy,
                show: !!file,
                disabled: !url,
            },
            {
                key: 'delete',
                label: t('common.delete'),
                icon: Trash2,
                show: !!file,
                destructive: true,
                separatorBefore: true,
            },
        ] satisfies MenuOption[]
    ).filter((option) => option.show);

    const runMenuAction = (action: MenuAction) => {
        switch (action) {
            case 'upload-system':
                inputRef.current?.click();
                break;
            case 'upload-manager':
                onOpenManager();
                break;
            case 'rename':
                handleRename();
                break;
            case 'copy-url':
                handleCopyUrl();
                break;
            case 'delete':
                onClear();
                break;
        }
    };

    return (
        <div className={cn('relative', boxSizeClass)}>
            <button
                type="button"
                onClick={handleClick}
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);

                    const dropped = e.dataTransfer.files?.[0];

                    if (dropped) {
                        onSelect(dropped);
                    }
                }}
                className={cn(
                    'group relative flex items-center justify-center overflow-hidden rounded-md border border-dashed border-input bg-muted/30 transition-colors hover:border-primary hover:bg-muted/50',
                    boxSizeClass,
                    isDragging && 'border-primary bg-primary/5',
                )}
            >
                {file ? (
                    <FileViewer file={file} />
                ) : size === 'sm' ? (
                    <Upload className="size-4 text-muted-foreground" />
                ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <Upload className="size-6" />
                        <span className="px-2 text-center text-xs">
                            {t('attachment_field.drag_and_drop_or')}
                        </span>
                    </div>
                )}
            </button>

            <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                    const selected = e.target.files?.[0];

                    if (selected) {
                        onSelect(selected);
                    }

                    e.target.value = '';
                }}
            />

            {size !== 'sm' && menuOptions.length > 0 && (
                <RowActionsMenu
                    trigger={
                        <button
                            type="button"
                            onClick={(e) => e.stopPropagation()}
                            className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-foreground"
                        >
                            <MoreHorizontal className="size-3.5" />
                        </button>
                    }
                    items={menuOptions.map((option) => ({
                        label: option.label,
                        icon: option.icon,
                        disabled: 'disabled' in option && option.disabled,
                        destructive:
                            'destructive' in option && option.destructive,
                        separatorBefore:
                            'separatorBefore' in option &&
                            option.separatorBefore,
                        onSelect: () => runMenuAction(option.key),
                    }))}
                />
            )}
        </div>
    );
}

export default function AttachmentField({
    name,
    accept = 'image/*',
    control,
    fieldProps,
    source,
    multiple = false,
    size,
}: AttachmentFieldProps) {
    void fieldProps;

    const sources = parseSources(source);
    // * undefined = closed, null = add a new slot, number = replace that slot.
    const [pickerTarget, setPickerTarget] = useState<number | null | undefined>(
        undefined,
    );

    if (!control) {
        return null;
    }

    return (
        <Controller
            name={name}
            control={control}
            render={({ field }) => {
                const attachments: FileViewerValue[] = multiple
                    ? Array.isArray(field.value)
                        ? field.value
                        : []
                    : [];
                const singleAttachment: FileViewerValue = multiple
                    ? null
                    : (field.value ?? null);

                const removeAt = (index: number) => {
                    field.onChange(attachments.filter((_, i) => i !== index));
                };

                const handleSelectAt =
                    (index: number | null) => (selectedFile: File) => {
                        if (!multiple) {
                            field.onChange(selectedFile);
                        } else if (index === null) {
                            field.onChange([...attachments, selectedFile]);
                        } else {
                            field.onChange(
                                attachments.map((attachment, i) =>
                                    i === index ? selectedFile : attachment,
                                ),
                            );
                        }
                    };

                const handleChangeAt =
                    (index: number | null) => (nextValue: FileViewerValue) => {
                        if (!multiple) {
                            field.onChange(nextValue);
                        } else if (index !== null) {
                            field.onChange(
                                attachments.map((attachment, i) =>
                                    i === index ? nextValue : attachment,
                                ),
                            );
                        }
                    };

                const handlePick = (urls: string[]) => {
                    if (pickerTarget === undefined) {
                        return;
                    }

                    if (!multiple) {
                        field.onChange({ url: urls[0] });
                    } else if (pickerTarget === null) {
                        field.onChange([
                            ...attachments,
                            ...urls.map((url) => ({ url })),
                        ]);
                    } else {
                        handleChangeAt(pickerTarget)({ url: urls[0] });
                    }
                };

                const picker = (
                    <FilePickerDialog
                        open={pickerTarget !== undefined}
                        onOpenChange={(open) =>
                            !open && setPickerTarget(undefined)
                        }
                        multiple={multiple && pickerTarget === null}
                        onPick={handlePick}
                    />
                );

                const boxAt = (index: number | null, file: FileViewerValue) => (
                    <AttachmentBox
                        key={index}
                        file={file}
                        accept={accept}
                        sources={sources}
                        size={size}
                        onSelect={handleSelectAt(index)}
                        onOpenManager={() => setPickerTarget(index)}
                        onChange={handleChangeAt(index)}
                        onClear={
                            !multiple
                                ? () => field.onChange(null)
                                : index === null
                                  ? () => {}
                                  : () => removeAt(index)
                        }
                    />
                );

                if (!multiple) {
                    return (
                        // * Wrapper avoids BaseField forcing direct children to w-full.
                        <div>
                            {boxAt(null, singleAttachment)}
                            {picker}
                        </div>
                    );
                }

                return (
                    <div className="flex flex-wrap gap-3">
                        {attachments.map((attachment, index) =>
                            boxAt(index, attachment),
                        )}
                        {boxAt(null, null)}
                        {picker}
                    </div>
                );
            }}
        />
    );
}
