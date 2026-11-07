import { Github } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuthStatus } from '@/hooks/use-auth-status';
import { Button } from '@/components/ui/button';
import FormField from '@/components/form/field';
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from '@/components/ui/field';
import { t } from '@/lib/i18n';
import { ideAuth } from '@/lib/ide-auth';
import { errorText } from '@/lib/ide';
import { MAX_NAME_LENGTH } from '@/lib/ide-settings';
import type { ChatSettings } from '@/lib/ide-settings';

/** Settings tab "Profile": the avatar, username and email taken from the signed-in accounts and the name the AI calls the person. */
export function CharacterTab({
    settings,
    loaded,
    onChange,
}: {
    settings: ChatSettings;
    /** True once the saved settings are in `settings`. */
    loaded: boolean;
    onChange: (settings: ChatSettings) => void;
}) {
    const [avatarError, setAvatarError] = useState<string | null>(null);
    // * Email of the GitHub profile, once read (it is often private and then empty).
    const [githubEmail, setGithubEmail] = useState('');
    const { statuses } = useAuthStatus(false);
    const github = statuses?.find((status) => status.provider === 'github');

    // * Fills the picture and the name the AI calls the person from the signed-in GitHub profile, which the backend reads (display name, else the login). A profile without a picture still fills the name.
    const fillFromGithub = async () => {
        setAvatarError(null);

        try {
            const profile = await ideAuth.githubProfile();

            setGithubEmail(profile.email);
            onChange({
                ...settings,
                avatar:
                    profile.avatar === '' ? settings.avatar : profile.avatar,
                userName: (profile.name || profile.login).slice(
                    0,
                    MAX_NAME_LENGTH,
                ),
            });

            if (profile.avatar === '') {
                setAvatarError(t('character_tab.could_not_load_github'));
            }
        } catch (caught) {
            setAvatarError(errorText(caught));
        }
    };

    // * First time the tab opens with no picture and no name, they are taken from the signed-in GitHub account (kept only when saved).
    const autoFilled = useRef(false);
    const githubAccount = github?.loggedIn ? github.account : null;
    // * The email of the GitHub profile when it is public, else the one of the signed-in Claude or Codex account (those are named by their email).
    const email =
        (githubEmail ||
            statuses?.find(
                (status) =>
                    status.provider !== 'github' &&
                    status.loggedIn &&
                    status.account?.includes('@'),
            )?.account) ??
        null;

    useEffect(() => {
        if (
            autoFilled.current ||
            !loaded ||
            !githubAccount ||
            settings.avatar !== '' ||
            settings.userName !== ''
        ) {
            return;
        }

        autoFilled.current = true;
        void fillFromGithub();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening, when the account and the saved values are known
    }, [loaded, githubAccount]);

    return (
        <FieldGroup>
            <Field>
                <FieldLabel>{t('character_tab.assistant_picture')}</FieldLabel>
                <div className="flex items-center gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xs text-muted-foreground">
                        {settings.avatar === '' ? (
                            t('common.default')
                        ) : (
                            <img
                                src={settings.avatar}
                                alt={t('character_tab.assistant_picture')}
                                className="size-full object-cover"
                            />
                        )}
                    </div>
                    {github?.loggedIn && github.account !== null && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void fillFromGithub()}
                        >
                            <Github aria-hidden="true" />
                            {t('character_tab.use_github_profile')}
                        </Button>
                    )}
                </div>
                {avatarError !== null && <FieldError>{avatarError}</FieldError>}
            </Field>
            {githubAccount && (
                <FormField
                    name="settings-github-username"
                    label={t('character_tab.username')}
                    value={githubAccount}
                    readOnly
                />
            )}
            {email && (
                <FormField
                    name="settings-account-email"
                    label={t('character_tab.email')}
                    value={email}
                    readOnly
                />
            )}
            <FormField
                name="settings-user-name"
                label={t('character_tab.name_the_ai_calls')}
                autoComplete="off"
                value={settings.userName}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) =>
                    onChange({
                        ...settings,
                        userName: event.target.value,
                    })
                }
            />
        </FieldGroup>
    );
}
