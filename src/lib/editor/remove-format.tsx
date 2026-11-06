import type { Editor } from '@tiptap/react';
import { RemoveFormatting } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

export function RemoveFormatToolbar({ editor }: { editor: Editor }) {
    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 min-w-8 px-1.5"
            onClick={() =>
                editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
            title={t('remove_format.clear_formatting')}
        >
            <RemoveFormatting className="size-3.5" />
        </Button>
    );
}
