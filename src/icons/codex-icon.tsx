import * as React from 'react';
import codex from '@/assets/codex.png';

export function CodexIcon(props: React.ImgHTMLAttributes<HTMLImageElement>) {
    return <img src={codex} alt="" {...props} />;
}
