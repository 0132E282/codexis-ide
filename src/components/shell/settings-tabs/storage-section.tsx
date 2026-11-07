import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/i18n';
import type { ChatSettings } from '@/lib/ide-settings';

/** Settings of where plans are kept and of the storage warnings; saved with the rest of the settings. */
export function StorageSection({
    settings,
    onChange,
}: {
    settings: ChatSettings;
    onChange: (settings: ChatSettings) => void;
}) {
    return (
        <>
            <Field>
                <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="settings-save-plans">
                        {t('storage_section.save_plans')}
                    </FieldLabel>
                    <Switch
                        id="settings-save-plans"
                        checked={settings.savePlansToProject}
                        onCheckedChange={(checked) =>
                            onChange({
                                ...settings,
                                savePlansToProject: checked,
                            })
                        }
                    />
                </div>
                <FieldDescription>
                    {t('storage_section.save_plans_hint')}
                </FieldDescription>
                {settings.savePlansToProject && (
                    <>
                        <FieldLabel htmlFor="settings-plans-dir">
                            {t('storage_section.plans_dir')}
                        </FieldLabel>
                        <Input
                            id="settings-plans-dir"
                            value={settings.plansDir}
                            autoComplete="off"
                            onChange={(event) =>
                                onChange({
                                    ...settings,
                                    plansDir: event.target.value,
                                })
                            }
                        />
                    </>
                )}
            </Field>
            <Field>
                <div className="flex items-center justify-between gap-3">
                    <FieldLabel htmlFor="settings-storage-warnings">
                        {t('storage_section.warnings')}
                    </FieldLabel>
                    <Switch
                        id="settings-storage-warnings"
                        checked={settings.storageWarnings}
                        onCheckedChange={(checked) =>
                            onChange({ ...settings, storageWarnings: checked })
                        }
                    />
                </div>
                <FieldDescription>
                    {t('storage_section.warnings_hint')}
                </FieldDescription>
                {settings.storageWarnings && (
                    <>
                        <FieldLabel htmlFor="settings-storage-multiplier">
                            {t('storage_section.multiplier')}
                        </FieldLabel>
                        <Input
                            id="settings-storage-multiplier"
                            type="number"
                            min={0.1}
                            step={0.5}
                            value={settings.storageWarnMultiplier}
                            onChange={(event) =>
                                onChange({
                                    ...settings,
                                    storageWarnMultiplier:
                                        Number(event.target.value) || 1,
                                })
                            }
                        />
                        <FieldDescription>
                            {t('storage_section.multiplier_hint')}
                        </FieldDescription>
                    </>
                )}
            </Field>
        </>
    );
}
