import { ChevronDown } from 'lucide-react';
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
import type { AgentCli } from '@/lib/ide';
import { t } from '@/lib/i18n';

// * Height of one menu item in pixels: the model list opens upward, its last item level with the AI it belongs to.
const MENU_ITEM_HEIGHT = 32;

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
    const selected = CLIS.find((option) => option.value === cli) ?? CLIS[0];
    const CliIcon = CLI_ICONS[selected.value];

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    aria-label={t('model_menu.choose_ai_and_model')}
                    className="gap-2 text-muted-foreground"
                >
                    <CliIcon aria-hidden="true" className="size-5" />
                    {MODELS[cli].find((option) => option.value === model)
                        ?.label ??
                        model ??
                        CLIS.find((option) => option.value === cli)?.label}
                    <ChevronDown aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {CLIS.map((option) => {
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
                                    -(MODELS[option.value].length - 1) *
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
                                    {MODELS[option.value].map((item) => (
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
