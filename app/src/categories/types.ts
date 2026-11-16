import type { ComponentType } from 'react';
import type { Locale, MessageKey, Translate } from '../i18n/messages';
import type { TutorialBridge } from '../onboarding';

// The shell knows presentation metadata, not a category's domain or storage schema.
export interface CategoryModule {
  id: string;
  name: MessageKey;
  description: MessageKey;
  openLabel: MessageKey;
  Icon: ComponentType;
  Screen: ComponentType<{ t: Translate; locale: Locale; tutorial?: TutorialBridge }>;
}
