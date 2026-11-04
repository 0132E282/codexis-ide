import Link from '@tiptap/extension-link';
import { LinkPopover } from '@/components/ui/link-popover';

export const LinkExtension = Link.configure({ openOnClick: false });

export const LinkToolbar = LinkPopover;
