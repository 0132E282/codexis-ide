import { useState } from 'react';
import { ChatImagesGrid } from '@/components/shell/chat-images-grid';
import { FileEventsTable } from '@/components/shell/file-events-table';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type DataTab = 'events' | 'images';

/** The "Dữ liệu" tab of the bottom panel: the edit log and the pictures of the chat, each with deletion (database rows only, never a file of the project). */
export function DataPane({ root }: { root: string | undefined }) {
    const [tab, setTab] = useState<DataTab>('events');
    const tabs: { id: DataTab; label: string }[] = [
        { id: 'events', label: t('data_pane.events') },
        { id: 'images', label: t('data_pane.images') },
    ];

    return (
        <div className="flex h-full min-h-0 flex-col text-xs">
            <div
                role="tablist"
                aria-label={t('data_pane.title')}
                className="flex shrink-0 gap-1 border-b px-2 py-1"
            >
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => setTab(item.id)}
                        className={cn(
                            'rounded-sm px-2 py-1 text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            tab === item.id &&
                                'bg-accent font-medium text-accent-foreground',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className={cn('min-w-0', tab === 'events' && 'max-w-6xl')}>
                    {tab === 'events' && <FileEventsTable root={root} />}
                    {tab === 'images' && <ChatImagesGrid root={root} />}
                </div>
            </div>
        </div>
    );
}
