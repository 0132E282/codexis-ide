import { Hand } from 'lucide-react';
import type { ComponentProps } from 'react';

// * Stand-in for the OpenClaw mark (a claw), not the official artwork.
export function OpenClawIcon(props: ComponentProps<typeof Hand>) {
    return <Hand {...props} />;
}
