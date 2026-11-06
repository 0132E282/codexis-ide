import {
    Bot,
    Link2,
    Plug,
    ScrollText,
    SlidersHorizontal,
    Sparkles,
    UserRound,
    Webhook,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AdvancedTab } from '@/components/shell/settings-tabs/advanced-tab';
import { AgentTab } from '@/components/shell/settings-tabs/agent-tab';
import { CharacterTab } from '@/components/shell/settings-tabs/character-tab';
import { ConnectTab } from '@/components/shell/settings-tabs/connect-tab';
import { HookTab } from '@/components/shell/settings-tabs/hook-tab';
import { McpTab } from '@/components/shell/settings-tabs/mcp-tab';
import { RulesTab } from '@/components/shell/settings-tabs/rules-tab';
import { SkillTab } from '@/components/shell/settings-tabs/skill-tab';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { t } from '@/lib/i18n';
import { defaultChatSettings, ideSettings } from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';

export type SettingsTab =
    | 'character'
    | 'advanced'
    | 'skill'
    | 'agent'
    | 'mcp'
    | 'rules'
    | 'hook'
    | 'connect';

const SECTIONS: {
    key: SettingsTab;
    label: string;
    title: string;
    icon: LucideIcon;
}[] = [
    {
        key: 'character',
        label: 'settings_dialog.character',
        title: 'settings_dialog.character_settings',
        icon: UserRound,
    },
    {
        key: 'advanced',
        label: 'settings_dialog.advanced',
        title: 'settings_dialog.advanced_settings',
        icon: SlidersHorizontal,
    },
    { key: 'skill', label: 'Skill', title: 'Skill', icon: Sparkles },
    { key: 'agent', label: 'Agent', title: 'Agent', icon: Bot },
    { key: 'mcp', label: 'MCP', title: 'MCP server', icon: Plug },
    { key: 'rules', label: 'Rules', title: 'Rules', icon: ScrollText },
    { key: 'hook', label: 'Hook', title: 'Hook', icon: Webhook },
    {
        key: 'connect',
        label: 'common.connect',
        title: 'common.connect',
        icon: Link2,
    },
];

/** Chat settings ("Cài đặt chat"): tabs on the left, the open tab on the right. `tab` null = closed. */
export function SettingsDialog({
    tab,
    onTabChange,
    onClose,
}: {
    tab: SettingsTab | null;
    onTabChange: (tab: SettingsTab) => void;
    onClose: () => void;
}) {
    const open = tab !== null;
    const [draft, setDraft] = useState<ChatSettings>(defaultChatSettings);
    // * The Kết nối tab shows its own page title while a sub-page is open.
    const [connectSubpage, setConnectSubpage] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reload the saved values each time the dialog opens, dropping unsaved edits.
    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;

        setError(null);
        ideSettings
            .get()
            .then((saved) => {
                if (!cancelled) {
                    setDraft(saved);
                }
            })
            .catch((caught: unknown) => {
                if (!cancelled) {
                    setError(String(caught));
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const save = async () => {
        setBusy(true);
        setError(null);

        try {
            setDraft(await ideSettings.save(draft));
            onClose();
        } catch (caught) {
            setError(String(caught));
        } finally {
            setBusy(false);
        }
    };

    const active = SECTIONS.find((section) => section.key === tab);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
        >
            <DialogContent className="flex h-[min(66vh,48rem)] w-[min(74vw,80rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]">
                <DialogHeader>
                    <DialogTitle>{t('common.chat_settings')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        {t('settings_dialog.character_advanced_options_skills')}
                    </DialogDescription>
                </DialogHeader>
                {tab !== null && (
                    <Tabs
                        orientation="vertical"
                        value={tab}
                        onValueChange={(value) =>
                            onTabChange(value as SettingsTab)
                        }
                        className="min-h-0 flex-1 gap-6"
                    >
                        <TabsList
                            aria-label={t('settings_dialog.settings_sections')}
                            className="h-fit w-44 shrink-0 gap-1 bg-transparent p-0"
                        >
                            {SECTIONS.map((section) => (
                                <TabsTrigger
                                    key={section.key}
                                    value={section.key}
                                    className="h-9 flex-none justify-start data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-accent"
                                >
                                    <section.icon aria-hidden="true" />
                                    {t(section.label)}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
                            {!(tab === 'connect' && connectSubpage) && (
                                <h3 className="text-base font-semibold">
                                    {active && t(active.title)}
                                </h3>
                            )}
                            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                                <TabsContent value="character">
                                    <CharacterTab
                                        settings={draft}
                                        onChange={setDraft}
                                    />
                                </TabsContent>
                                <TabsContent value="advanced">
                                    <AdvancedTab
                                        settings={draft}
                                        onChange={setDraft}
                                    />
                                </TabsContent>
                                <TabsContent value="skill">
                                    <SkillTab />
                                </TabsContent>
                                <TabsContent value="agent">
                                    <AgentTab />
                                </TabsContent>
                                <TabsContent value="mcp">
                                    <McpTab />
                                </TabsContent>
                                <TabsContent value="rules">
                                    <RulesTab />
                                </TabsContent>
                                <TabsContent value="hook">
                                    <HookTab />
                                </TabsContent>
                                <TabsContent value="connect">
                                    <ConnectTab onSubpage={setConnectSubpage} />
                                </TabsContent>
                            </div>
                            {error !== null && (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {error}
                                </p>
                            )}
                            {(tab === 'character' || tab === 'advanced') && (
                                <DialogFooter className="border-t pt-3">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={onClose}
                                    >
                                        {t('common.cancel')}
                                    </Button>
                                    <Button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void save()}
                                    >
                                        {busy
                                            ? t('settings_dialog.saving')
                                            : t('common.save')}
                                    </Button>
                                </DialogFooter>
                            )}
                        </div>
                    </Tabs>
                )}
            </DialogContent>
        </Dialog>
    );
}
