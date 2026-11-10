import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CLI_ICONS, CLIS, MODELS } from '@/components/shell/chat/cli-options';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ide, type AgentCli } from '@/lib/ide';
import { t } from '@/lib/i18n';

// * Height of one menu item in pixels: the model list opens upward, its last item level with the AI it belongs to.
const MENU_ITEM_HEIGHT = 32;

/** The models each AI offers: the fixed list until the backend answers with the ones the CLI really lists for this account (a CLI that keeps no list stays on the fixed one). */
function useModels() {
    const [models, setModels] = useState(MODELS);

    const load = useCallback((clis: AgentCli[]) => {
        for (const cli of clis) {
            ide.agentModels(cli)
                .then((listed) =>
                    setModels((current) => ({
                        ...current,
                        // * Dynamic-only CLIs leave the menu when they list no available model; the others keep their fixed list.
                        [cli]:
                            listed.length > 0 ||
                            cli === 'antigravity' ||
                            cli === 'ollama'
                                ? listed
                                : current[cli],
                    })),
                )
                .catch(() => undefined);
        }
    }, []);

    useEffect(() => {
        load(CLIS.map((option) => option.value));
    }, [load]);

    // * Antigravity is signed in from the accounts page, so its list is read again whenever the menu opens.
    return { models, reloadAntigravity: () => load(['antigravity']) };
}

/** The button that shows the chosen AI and model, and the menu that picks both: a model under each AI. */
export function ModelMenu({
    busy,
    cli,
    model,
    onChoose,
}: {
    busy: boolean;
    cli: AgentCli;
    /** Model of the chosen CLI (null: its default). */
    model: string | null;
    onChoose: (cli: AgentCli, model: string | null) => void;
}) {
    const { models, reloadAntigravity } = useModels();
    const visibleClis = CLIS.filter(
        (option) => models[option.value].length > 0,
    );
    const selected = CLIS.find((option) => option.value === cli) ?? CLIS[0];
    const CliIcon = CLI_ICONS[selected.value];

    return (
        <DropdownMenu onOpenChange={(open) => open && reloadAntigravity()}>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('model_menu.choose_ai_and_model')}
                    className="min-w-0 gap-2 text-muted-foreground"
                >
                    <CliIcon aria-hidden="true" className="size-5" />
                    <span className="truncate">
                        {models[cli].find((option) => option.value === model)
                            ?.label ??
                            model ??
                            CLIS.find((option) => option.value === cli)?.label}
                    </span>
                    <ChevronDown aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {visibleClis.map((option) => {
                    const OptionIcon = CLI_ICONS[option.value];

                    return (
                        <DropdownMenuSub key={option.value}>
                            <DropdownMenuSubTrigger
                                className={
                                    option.value === cli
                                        ? 'font-medium'
                                        : undefined
                                }
                            >
                                <OptionIcon
                                    aria-hidden="true"
                                    className="size-4"
                                />
                                {option.label}
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent
                                alignOffset={
                                    -(models[option.value].length - 1) *
                                    MENU_ITEM_HEIGHT
                                }
                            >
                                <DropdownMenuRadioGroup
                                    value={
                                        option.value === cli
                                            ? (model ?? '')
                                            : ''
                                    }
                                    onValueChange={(next) =>
                                        onChoose(option.value, next || null)
                                    }
                                >
                                    {models[option.value].map((item) => (
                                        <DropdownMenuRadioItem
                                            key={item.value ?? 'default'}
                                            value={item.value ?? ''}
                                        >
                                            {item.label}
                                        </DropdownMenuRadioItem>
                                    ))}
                                </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    );
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
