// Supported UI locales. Adding a new locale: create dict in `./locales/`, register
// in `./index.tsx`, and add the human label to `LOCALE_LABEL` below. The
// alignment test `locales.test.ts` will fail until every locale has all keys.
//
// Coverage policy: UN 6 official languages (en / zh / es / fr / ru / ar) +
// CJK rounded out with ja / ko. Chinese kept as both zh-CN and zh-TW so
// Mainland and Greater China users get the right written form. Total 9.
export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'es-ES' | 'fr' | 'ru' | 'ar' | 'ja' | 'ko';

export const LOCALES: Locale[] = ['en', 'zh-CN', 'zh-TW', 'es-ES', 'fr', 'ru', 'ar', 'ja', 'ko'];

export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'es-ES': 'Español (España)',
  fr: 'Français',
  ru: 'Русский',
  ar: 'العربية',
  ja: '日本語',
  ko: '한국어',
};

// Right-to-left locales — flipped via document.documentElement.dir in the
// I18nProvider. Browsers and CSS logical properties handle the rest.
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(['ar']);

// Translation dictionary shape — flat keys, dot-namespaced. Keeping it flat
// (not deeply nested) means a missing-key TS error points straight at the
// offending string instead of a generic object mismatch.
export interface Dict {
  // Common — reusable atoms across every screen
  'common.cancel': string;
  'common.save': string;
  'common.close': string;
  'common.delete': string;
  'common.retry': string;
  'common.retrying': string;
  'common.loading': string;
  'common.share': string;
  'common.comingSoon': string;
  'common.send': string;
  'common.sending': string;
  'common.discard': string;
  'common.undo': string;
  'common.bundling': string;
  'common.justNow': string;
  'common.minutesAgo': string;
  'common.hoursAgo': string;
  'common.daysAgo': string;
  'common.today': string;
  'common.yesterday': string;
  'common.earlier': string;
  'common.daysAgoShort': string;
  'common.open': string;

  // App / brand
  'app.brand': string;
  'app.brandSub': string;
  'app.brandPill': string;

  // Home — top tabs
  'home.topTab.designs': string;
  'home.topTab.examples': string;
  'home.topTab.designSystems': string;
  'home.comingSoonEmpty': string;

  // Home — rail / create form
  'home.newPrototype': string;
  'home.newGeneric': string;
  'home.projectNameLabel': string;
  'home.projectNamePlaceholder': string;
  'home.fidelityWireframe': string;
  'home.fidelityHigh': string;
  'home.create': string;
  'home.creating': string;

  // Home — TypePicker tabs (4 type cards on the rail)
  'home.typePicker.prototype': string;
  'home.typePicker.slideDeck': string;
  'home.typePicker.fromTemplate': string;
  'home.typePicker.other': string;

  // Home — DesignSystemPicker (5 system cards in the picker grid)
  'home.designSystem.openDesignDefault': string;
  'home.designSystem.claudeStyle': string;
  'home.designSystem.atelierSystem': string;
  'home.designSystem.material3': string;
  'home.designSystem.none': string;
  'home.designSystem.freeStyle': string;
  'home.designSystem.default': string;

  // Home — import .zip
  'home.importZip': string;
  'home.importing': string;
  'home.importProgress': string;
  'home.importProgressWith': string;
  'home.importZipAria': string;
  'home.importToastSkipped': string;
  'home.importToastOk': string;
  'home.importFailed': string;

  'home.privacyHint': string;

  // Home — API key rail button
  'home.apiKeysLabel': string;
  'home.apiKeysSet': string;
  'home.apiKeyTipSet': string;
  'home.apiKeyTipUnset': string;

  // Home — sub tabs / project list
  'home.subTab.recent': string;
  'home.subTab.yours': string;
  'home.loadingProjects': string;
  'home.emptyNoProjects': string;
  'home.errorLoad': string;

  // ProjectCard (the cards in the grid)
  'projectCard.subYourDesign': string;
  'projectCard.subDesignSystem': string;
  'projectCard.menuRename': string;
  'projectCard.menuDelete': string;
  'projectCard.menuAria': string;
  'projectCard.openAria': string;
  'projectCard.newBadge': string;
  'projectCard.deleteConfirm': string;
  'projectCard.renameAria': string;
  'projectCard.jumpToPin': string;

  // ExamplesTab — the right-pane gallery
  'examples.intro': string;
  'examples.useThisPrompt': string;
  'examples.creating': string;
  'examples.hoverHint': string;

  // Workspace header
  'header.home': string;
  'header.present': string;
  'header.presentFullScreen': string;
  'header.presentFullScreenHint': string;
  'header.presentWithoutChrome': string;
  'header.presentWithoutChromeHint': string;
  'header.share': string;
  'header.settings': string;

  // Workspace top-level structure
  'workspace.chatToolsAria': string;
  'workspace.dropFilesHint': string;
  'workspace.errorMissingId': string;
  'workspace.errorNotFoundTitle': string;
  'workspace.errorNotFoundLine1': string;
  'workspace.errorNotFoundLine2': string;
  'workspace.errorBackHome': string;
  'workspace.errorLoadTitle': string;
  'workspace.errorLoadLine1': string;
  'workspace.errorLoadLine2': string;

  // Present route
  'present.error': string;
  'present.escHint': string;
  'present.loading': string;
  'present.empty': string;
  'present.escHintExit': string;

  // Workspace TabBar (Design Files / Preview file tabs)
  'workspace.tab.designFiles': string;
  'workspace.tab.preview': string;
  'workspace.tab.openFilesAria': string;
  'workspace.tab.closeAria': string;

  // ChatTabBar (Chat 1 / Comments / Activity row)
  'workspace.chats.aria': string;
  'workspace.chats.chatLabel': string;
  'workspace.chats.newChat': string;
  'workspace.chats.deleteConfirmAria': string;
  'workspace.chats.commentsTab': string;
  'workspace.chats.commentsTabWithCount': string;
  'workspace.chats.activityTab': string;

  // Workspace SharePopover
  'share.downloadZip': string;
  'share.bundling': string;
  'share.aria': string;

  // Toolbar — the 4 preview tools + the right-side actions
  'toolbar.tool.tweaks': string;
  'toolbar.tool.comment': string;
  'toolbar.tool.edit': string;
  'toolbar.tool.draw': string;
  'toolbar.reload': string;
  'toolbar.openInNewTab': string;
  'toolbar.present': string;
  'toolbar.presentFullScreen': string;
  'toolbar.presentFullScreenHint': string;
  'toolbar.presentWithoutChrome': string;
  'toolbar.presentWithoutChromeHint': string;
  'toolbar.zoom': string;
  'toolbar.fit': string;
  'toolbar.zoomActive': string;

  // FileTree (left of preview)
  'fileTree.title': string;
  'fileTree.todosLabel': string;
  'fileTree.empty': string;
  'fileTree.emptyHint': string;
  'fileTree.errorLoad': string;
  'fileTree.newFile': string;
  'fileTree.newFolder': string;
  'fileTree.section.pages': string;
  'fileTree.section.components': string;
  'fileTree.section.scripts': string;
  'fileTree.section.images': string;
  'fileTree.section.sketches': string;
  'fileTree.section.other': string;

  // FilePreviewPane
  'filePane.open': string;
  'filePane.empty': string;
  'filePane.errorLoad': string;
  'filePane.noPreview': string;
  'filePane.modifiedMeta': string;
  'filePane.openHintPrefix': string;
  'filePane.openHintSuffix': string;

  // File type labels (used by FilePreviewPane.prettyType)
  'fileType.htmlPage': string;
  'fileType.component': string;
  'fileType.stylesheet': string;
  'fileType.json': string;
  'fileType.svg': string;
  'fileType.image': string;
  'fileType.script': string;

  // PreviewPanel hints
  'preview.editModeUnavailable': string;
  'preview.clickToSelect': string;
  'preview.drawActive': string;
  'preview.drawLeaveHint': string;
  'preview.errorLoadFiles': string;
  'preview.emptyTitle': string;
  'preview.emptySub': string;
  'preview.commentHint': string;
  'preview.toolNeedsPreview': string;
  'preview.tweaksUnavailable': string;

  // CommentPinOverlay
  'commentPin.empty': string;
  'commentPin.jumpTitle': string;
  'commentPin.placeholder': string;
  'commentPin.savePin': string;
  'commentPin.sendToAtelier': string;

  // DrawDock submode buttons + actions
  'drawDock.submodeDraw': string;
  'drawDock.submodePoint': string;
  'drawDock.submodeVoice': string;
  'drawDock.undo': string;
  'drawDock.discard': string;
  'drawDock.send': string;
  'drawDock.sending': string;
  'drawDock.notePlaceholder': string;
  'drawDock.noteAria': string;
  'drawDock.marksCount': string;

  // EditFloat (the inline element editor)
  'editFloat.title': string;
  'editFloat.showing': string;
  'editFloat.pageDefault': string;
  'editFloat.background': string;
  'editFloat.fontFamily': string;
  'editFloat.bodySize': string;
  'editFloat.headingSize': string;
  'editFloat.color': string;

  // Chat composer
  'chat.addContext': string;
  'chat.composerPlaceholder': string;
  'chat.composerAria': string;
  'chat.attachComingSoon': string;
  'chat.attachAria': string;
  'chat.voiceComingSoon': string;
  'chat.voiceAria': string;
  'chat.send': string;
  'chat.stop': string;
  'chat.removeAria': string;

  // Chat thread states
  'chat.thinking': string;
  'chat.verifierChecking': string;

  // ChatMsg tool labels — verb chip for each agent tool. Keep these short
  // (≤10 chars in en) so they fit the fixed-width verb column in the chat
  // history. Mirrors the v1 verb-map (Reading/Writing/Editing/Copying/Done)
  // and adds the v2 tool set. Falls back to a lowercased-with-spaces version
  // of the type name for any tool without an explicit case.
  'chat.tool.writing': string;
  'chat.tool.reading': string;
  'chat.tool.editing': string;
  'chat.tool.listing': string;
  'chat.tool.copying': string;
  'chat.tool.deleting': string;
  'chat.tool.viewing': string;
  'chat.tool.fetching': string;
  'chat.tool.grep': string;
  'chat.tool.done': string;
  'chat.tool.snipping': string;
  'chat.tool.todos': string;
  'chat.tool.registering': string;
  'chat.tool.skill': string;
  'chat.tool.verifying': string;
  'chat.tool.feedback': string;
  'chat.tool.questioning': string;
  'chat.tool.screenshotting': string;
  'chat.tool.evaluating': string;
  'chat.tool.logs': string;
  'chat.tool.opening': string;
  'chat.tool.downloading': string;

  // CommentsTab
  'comments.errorLoad': string;
  'comments.errorPartial': string;
  'comments.errorReload': string;
  'comments.empty.intro': string;
  'comments.empty.toolName': string;
  'comments.empty.instruction': string;
  'comments.deletePinAria': string;
  'comments.selectPinAria': string;
  'comments.selectedCount': string;
  'comments.toggleHide': string;
  'comments.toggleAdd': string;
  'comments.sendToClaude': string;
  'comments.notePlaceholder': string;
  'comments.aggregated': string;
  'comments.aggregatedNoSelector': string;
  'comments.noComment': string;

  // ImportPopover (chat input "Add context" menu)
  'import.option.localCodebase': string;
  'import.option.github': string;
  'import.option.figma': string;
  'import.option.uploadScreenshots': string;
  'import.option.designSystems': string;
  'import.option.attachSkill': string;
  'import.soonBadge': string;
  'import.comingSoon': string;

  // SkillPicker submenu (chat input "Attach skill" → list of skills)
  'skillPicker.menuAria': string;
  'skillPicker.empty': string;

  // Skill attachment chip (above the textarea, post-pick)
  'skillChip.kindLabel': string;
  'skillChip.removeAria': string;

  // ModelDropdown (in the composer)
  'modelDropdown.noKey': string;
  'modelDropdown.addKeyFirst': string;

  // TodosPanel
  'todos.title': string;

  // Settings (API key modal + form)
  'settings.modalTitle': string;
  'settings.modalSubtitle': string;
  'settings.providerTabsAria': string;
  'settings.apiKeyLabel': string;
  'settings.save': string;
  'settings.clear': string;
  'settings.test': string;
  'settings.enterKeyError': string;
  'settings.testing': string;
  'settings.keyOk': string;
  'settings.storageNote': string;
  'settings.getKey': string;
  'settings.language': string;
  'settings.languageHint': string;

  // Language menu
  'lang.menuAria': string;
  'lang.tooltip': string;
}
