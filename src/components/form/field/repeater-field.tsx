import { Copy, Eye, Plus, Trash2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import type { Control } from 'react-hook-form';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import AttachmentField from '@/components/form/field/attachment-field';
import InputField from '@/components/form/field/input-field';
import SelectField from '@/components/form/field/select-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
    Sheet,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type RepeaterColumnWidth = 'sm' | 'md' | 'lg' | 'xl';

export type RepeaterColumn = {
    name: string;
    label?: string;
    ui?: 'input' | 'checkbox' | 'attachment' | 'select';
    width?: RepeaterColumnWidth;
    /** * `ui: 'checkbox'`: only one row can be checked (e.g. is_default); the first row defaults to checked. */
    exclusive?: boolean;
    multiple?: boolean;
    /** * `ui: 'input'`: adds the column to the quick-fill toolbar (one value for every row). */
    quickFill?: boolean;
};

export interface RepeaterFieldProps {
    name: string;
    control?: Control;
    fields?: RepeaterColumn[];
    /** * Columns shown in the inline table; the rest stay editable in the row-detail popup. Omit to show all. */
    views?: string[];
    addLabel?: string;
    fieldProps?: unknown;
    maxLength?: unknown;
    source?: unknown;
}

const WIDTH_CLASS: Record<RepeaterColumnWidth, string> = {
    sm: 'w-20',
    md: 'w-32',
    lg: 'w-48',
    xl: 'w-80',
};

type CellProps = {
    /** * Repeater field name (e.g. "variants"), needed to reset sibling rows for `exclusive`. */
    parentName: string;
    index: number;
    name: string;
    control: Control;
    column: RepeaterColumn;
    large?: boolean;
};

function CheckboxCell({
    parentName,
    index,
    name,
    control,
    column,
    large,
}: CellProps) {
    const { setValue } = useFormContext();
    const { fields: siblingRows } = useFieldArray({
        control,
        name: parentName,
    });

    return (
        <Controller
            name={name}
            control={control}
            render={({ field }) => (
                <Checkbox
                    checked={!!field.value}
                    onCheckedChange={(checked) => {
                        field.onChange(!!checked);

                        if (checked && column.exclusive) {
                            siblingRows.forEach((_, i) => {
                                if (i !== index) {
                                    setValue(
                                        `${parentName}.${i}.${column.name}`,
                                        false,
                                    );
                                }
                            });
                        }
                    }}
                    className={large ? undefined : 'mx-auto'}
                />
            )}
        />
    );
}

function AttachmentCell({ name, control, column, large }: CellProps) {
    return (
        <AttachmentField
            name={name}
            control={control}
            multiple={column.multiple}
            size={large ? 'lg' : 'sm'}
        />
    );
}

function InputCell({ name, control }: CellProps) {
    const { register } = useFormContext();

    return (
        <InputField
            name={name}
            control={control}
            fieldProps={register(name)}
            className="h-9"
            onClick={(event) => event.stopPropagation()}
        />
    );
}

function SelectCell({ name, control, column }: CellProps) {
    return (
        <SelectField name={name} control={control} multiple={column.multiple} />
    );
}

const CELL_COMPONENTS: Record<
    NonNullable<RepeaterColumn['ui']>,
    ComponentType<CellProps>
> = {
    input: InputCell,
    checkbox: CheckboxCell,
    attachment: AttachmentCell,
    select: SelectCell,
};

function RepeaterCell(props: CellProps) {
    const Component = CELL_COMPONENTS[props.column.ui ?? 'input'];

    return <Component {...props} />;
}

function RepeaterRowDetail({
    parentName,
    index,
    control,
    fields,
}: {
    parentName: string;
    index: number;
    control: Control;
    fields: RepeaterColumn[];
}) {
    const rowPath = `${parentName}.${index}`;

    return (
        <div className="flex flex-col gap-4">
            {fields.map((column) =>
                column.ui === 'checkbox' ? (
                    <div key={column.name} className="flex items-center gap-2">
                        <RepeaterCell
                            parentName={parentName}
                            index={index}
                            name={`${rowPath}.${column.name}`}
                            control={control}
                            column={column}
                            large
                        />
                        <span className="text-sm font-medium">
                            {column.label ?? column.name}
                        </span>
                    </div>
                ) : (
                    <div key={column.name} className="flex flex-col gap-1.5">
                        <span className="text-sm font-medium">
                            {column.label ?? column.name}
                        </span>
                        <RepeaterCell
                            parentName={parentName}
                            index={index}
                            name={`${rowPath}.${column.name}`}
                            control={control}
                            column={column}
                            large
                        />
                    </div>
                ),
            )}
        </div>
    );
}

function RepeaterRow({
    name,
    index,
    control,
    fields,
    onRemove,
    onOpenDetail,
}: {
    name: string;
    index: number;
    control: Control;
    fields: RepeaterColumn[];
    onRemove: () => void;
    onOpenDetail: () => void;
}) {
    const rowPath = `${name}.${index}`;

    return (
        <tr className="border-b last:border-0">
            {fields.map((column) => (
                <td
                    key={column.name}
                    className={cn(
                        'px-2 py-1',
                        column.width && WIDTH_CLASS[column.width],
                    )}
                >
                    <RepeaterCell
                        parentName={name}
                        index={index}
                        name={`${rowPath}.${column.name}`}
                        control={control}
                        column={column}
                    />
                </td>
            ))}
            <td className="px-2 py-1 text-right whitespace-nowrap">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title={t('common.view_details')}
                    onClick={onOpenDetail}
                >
                    <Eye className="size-4" />
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={onRemove}
                >
                    <Trash2 className="size-4 text-destructive" />
                </Button>
            </td>
        </tr>
    );
}

function QuickFillToolbar({
    parentName,
    fields,
    rowCount,
}: {
    parentName: string;
    fields: RepeaterColumn[];
    rowCount: number;
}) {
    const { setValue } = useFormContext();
    const quickFillColumns = fields.filter((column) => column.quickFill);
    const [values, setValues] = useState<Record<string, string>>({});

    if (quickFillColumns.length === 0) {
        return null;
    }

    const apply = () => {
        for (const column of quickFillColumns) {
            if (!values[column.name]) {
                continue;
            }

            for (let i = 0; i < rowCount; i++) {
                setValue(
                    `${parentName}.${i}.${column.name}`,
                    values[column.name],
                    { shouldDirty: true },
                );
            }
        }
    };

    const gridColsClass: Record<1 | 2 | 3 | 4, string> = {
        1: 'grid-cols-1',
        2: 'grid-cols-2',
        3: 'grid-cols-3',
        4: 'grid-cols-4',
    };

    return (
        <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
            <div
                className={cn(
                    'grid flex-1 gap-3',
                    quickFillColumns.length > 4
                        ? 'auto-cols-40 grid-flow-col overflow-x-auto'
                        : gridColsClass[
                              quickFillColumns.length as 1 | 2 | 3 | 4
                          ],
                )}
            >
                {quickFillColumns.map((column) => (
                    <div
                        key={column.name}
                        className="flex items-center gap-1.5"
                    >
                        <span className="shrink-0 text-xs text-muted-foreground">
                            {column.label ?? column.name}
                        </span>
                        <Input
                            value={values[column.name] ?? ''}
                            onChange={(event) =>
                                setValues((current) => ({
                                    ...current,
                                    [column.name]: event.target.value,
                                }))
                            }
                            className="h-8 min-w-0 flex-1"
                            onClick={(event) => event.stopPropagation()}
                        />
                    </div>
                ))}
            </div>

            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ml-auto h-8 shrink-0"
                onClick={apply}
                disabled={!rowCount}
            >
                {t('common.apply')}
            </Button>
        </div>
    );
}

/** * `useFieldArray` table; row values live at `{name}.{index}.{column.name}`, the eye icon opens every column. */
export default function RepeaterField({
    name,
    control,
    fields = [],
    views = [],
    addLabel = t('repeater_field.add_row'),
}: RepeaterFieldProps) {
    const [detailIndex, setDetailIndex] = useState<number | null>(null);
    const {
        fields: rows,
        append,
        insert,
        remove,
    } = useFieldArray({ control, name });
    const { getValues } = useFormContext();

    const duplicateRow = (index: number) => {
        const current = getValues(`${name}.${index}`) as Record<
            string,
            unknown
        >;

        insert(index + 1, { ...current });
        setDetailIndex(index + 1);
    };

    const removeRow = (index: number) => {
        remove(index);
        setDetailIndex(null);
    };

    const addRow = (openDetail = false) => {
        const exclusiveColumn = fields.find((column) => column.exclusive);

        append(
            rows.length === 0 && exclusiveColumn
                ? { [exclusiveColumn.name]: true }
                : {},
        );

        if (openDetail) {
            setDetailIndex(rows.length);
        }
    };

    // * Start with one row: submitting zero rows is rarely intended.
    useEffect(() => {
        if (rows.length === 0) {
            addRow();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only run once on mount, `addRow` reads current `rows`/`fields` via closure
    }, []);

    if (!control) {
        return null;
    }

    const tableFields = views.length
        ? fields.filter((column) => views.includes(column.name))
        : fields;

    return (
        <div className="flex flex-col gap-2">
            <QuickFillToolbar
                parentName={name}
                fields={tableFields}
                rowCount={rows.length}
            />

            {rows.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                    <div className="max-h-112 overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 z-10 bg-background">
                                <tr className="border-b bg-muted/50">
                                    {tableFields.map((column) => (
                                        <th
                                            key={column.name}
                                            className={cn(
                                                'px-2 py-1 text-left font-medium text-muted-foreground',
                                                column.width &&
                                                    WIDTH_CLASS[column.width],
                                            )}
                                        >
                                            {column.label ?? column.name}
                                        </th>
                                    ))}
                                    <th className="w-9" />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, index) => (
                                    <RepeaterRow
                                        key={row.id}
                                        name={name}
                                        index={index}
                                        control={control}
                                        fields={tableFields}
                                        onRemove={() => remove(index)}
                                        onOpenDetail={() =>
                                            setDetailIndex(index)
                                        }
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => addRow(true)}
            >
                <Plus className="size-4" />
                {addLabel}
            </Button>

            <Sheet
                open={detailIndex !== null}
                onOpenChange={(open) => !open && setDetailIndex(null)}
            >
                <SheetContent
                    side="right"
                    showCloseButton={false}
                    className="w-2/3 max-w-none sm:max-w-none"
                >
                    <SheetHeader className="shrink-0 flex-row items-center justify-between gap-2 border-b">
                        <SheetTitle>{t('repeater_field.details')}</SheetTitle>
                        {detailIndex !== null && (
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-destructive hover:text-destructive"
                                    onClick={() => removeRow(detailIndex)}
                                >
                                    <Trash2 className="size-4" />
                                    {t('common.delete')}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => duplicateRow(detailIndex)}
                                >
                                    <Copy className="size-4" />
                                    {t('repeater_field.duplicate')}
                                </Button>
                                <SheetClose asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8"
                                    >
                                        {t('common.cancel')}
                                    </Button>
                                </SheetClose>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => setDetailIndex(null)}
                                >
                                    {t('common.save')}
                                </Button>
                            </div>
                        )}
                    </SheetHeader>
                    <div className="flex-1 overflow-y-auto p-4">
                        {detailIndex !== null && (
                            <RepeaterRowDetail
                                parentName={name}
                                index={detailIndex}
                                control={control}
                                fields={fields}
                            />
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </div>
    );
}
