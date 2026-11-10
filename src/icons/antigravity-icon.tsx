import * as React from 'react';

// * Approximation of the Google Antigravity mark (an arch with a short bar under it), not the official artwork.
export function AntigravityIcon(props: React.SVGProps<SVGSVGElement>) {
    const gradientId = React.useId();
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            {...props}
        >
            <defs>
                <linearGradient
                    id={gradientId}
                    x1="4"
                    y1="21"
                    x2="20"
                    y2="3"
                    gradientUnits="userSpaceOnUse"
                >
                    <stop offset="0" stopColor="#EA4335" />
                    <stop offset="0.5" stopColor="#4285F4" />
                    <stop offset="1" stopColor="#34A853" />
                </linearGradient>
            </defs>
            <path
                d="M4.5 20.5C4.5 9 8 3.5 12 3.5s7.5 5.5 7.5 17M9 16.5h6"
                stroke={`url(#${gradientId})`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
