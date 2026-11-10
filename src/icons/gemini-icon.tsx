import * as React from 'react';

export function GeminiIcon(props: React.SVGProps<SVGSVGElement>) {
    const gradientId = React.useId();
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
            <defs>
                <linearGradient
                    id={gradientId}
                    x1="3"
                    y1="20"
                    x2="21"
                    y2="4"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop offset="0" stopColor="#4285F4" />
                    <stop offset="0.55" stopColor="#9168C0" />
                    <stop offset="1" stopColor="#D96570" />
                </linearGradient>
            </defs>
            <path
                d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.304 14.304 0 0 0 12 12 14.304 14.304 0 0 0-12 12"
                fill={`url(#${gradientId})`}
            />
        </svg>
    );
}
