/**
 * @license
 * Copyright DagonMetric. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found under the LICENSE file in the root directory of this source tree.
 */

import { isPlatformBrowser } from '@angular/common';
import {
    ApplicationRef,
    Component,
    HostBinding,
    Inject,
    OnDestroy,
    OnInit,
    PLATFORM_ID,
    ViewChild,
    ViewEncapsulation
} from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';

import { BreakpointObserver } from '@angular/cdk/layout';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatBottomSheet } from '@angular/material/bottom-sheet';
import { MatSidenav } from '@angular/material/sidenav';
import { MatSnackBar } from '@angular/material/snack-bar';

import { Observable, Subject, concat, interval } from 'rxjs';
import { filter, first, map, takeUntil } from 'rxjs/operators';

import { CacheService } from '@dagonmetric/ng-cache';
import { ConfigService } from '@dagonmetric/ng-config';
import { LogService, Logger } from '@dagonmetric/ng-log';

import { environment } from '../environments/environment';
import { LinkService } from '../modules/seo';

import { appSettings } from './shared/app-settings';
import { NavLinkItem } from './shared/nav-link-item';
import { SocialSharingSheetComponent } from './shared/social-sharing-sheet';
import { Sponsor } from './shared/sponsor';
import { UrlHelper } from './shared/url-helper';

const SMALL_WIDTH_BREAKPOINT = 720;

/**
 * Core app component.
 */
@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit, OnDestroy {
    @ViewChild('sidenav', { static: false })
    sidenav?: MatSidenav;

    @HostBinding('class') componentClass?: string;

    isScreenSmall?: Observable<boolean>;
    isHomePage = true;
    sponsors: Sponsor[] = [];

    get isDarkMode(): boolean {
        return this._isDarkMode == null ? false : this._isDarkMode;
    }
    set isDarkMode(value: boolean) {
        this.setDarkMode(value);

        this._logger.trackEvent({
            name: value ? 'change_dark_mode' : 'change_light_mode',
            properties: {
                app_version: appSettings.appVersion,
                app_platform: 'web'
            }
        });
    }

    get appTitle(): string {
        return appSettings.appName;
    }

    get appTitleFull(): string {
        return `${this.appTitle} | Myanmar Tools`;
    }

    get appVersion(): string {
        return appSettings.appVersion;
    }

    get appDescription(): string {
        return appSettings.appDescription;
    }

    get logoUrl(): string {
        return environment.production ? this._urlHelper.toAbsoluteUrl(this._logoUrl) : this._logoUrl;
    }

    get communityLinks(): NavLinkItem[] {
        if (this._isAppUsedBefore) {
            return appSettings.navLinks;
        } else {
            return appSettings.navLinks.filter((navLink) => navLink.expanded === true);
        }
    }

    get aboutSectionVisible(): boolean {
        return this.isHomePage && !this._isAppUsedBefore && !this._aboutPageNavigated ? true : false;
    }

    get sponsorSectionVisible(): boolean {
        return this._hideSponsorSection ||
            !this.sponsors ||
            !this.sponsors.length ||
            !this._isBrowser ||
            !this.isHomePage ||
            this.aboutSectionVisible
            ? false
            : true;
    }

    private readonly _logoUrl = 'assets/images/appicons/v1/logo.png';
    private readonly _isBrowser: boolean;
    private readonly _curVerAppUsedCount: number = 0;
    private readonly _isAppUsedBefore: boolean = false;
    private readonly _checkInterval = 1000 * 60 * 60 * 6;
    private readonly _onDestroy = new Subject<void>();
    private readonly _logger: Logger;

    private _isFirstNavigation = true;
    private _pageClass?: string;
    private _themeClass?: string;
    private _aboutPageNavigated = false;
    private _hideSponsorSection = false;
    private _colorMode?: string;
    private _isDarkMode?: boolean | null = null;

    constructor(
        // eslint-disable-next-line @typescript-eslint/ban-types
        @Inject(PLATFORM_ID) platformId: Object,
        logService: LogService,
        private readonly _configService: ConfigService,
        private readonly _snackBar: MatSnackBar,
        private readonly _appRef: ApplicationRef,
        private readonly _swUpdate: SwUpdate,
        private readonly _cacheService: CacheService,
        private readonly _overlayContainer: OverlayContainer,
        private readonly _urlHelper: UrlHelper,
        private readonly _titleService: Title,
        private readonly _linkService: LinkService,
        private readonly _metaService: Meta,
        private readonly _router: Router,
        private readonly _activatedRoute: ActivatedRoute,
        private readonly _bottomSheet: MatBottomSheet,
        breakpointObserver: BreakpointObserver
    ) {
        this._logger = logService.createLogger('app');
        this._isBrowser = isPlatformBrowser(platformId);

        if (this._isBrowser) {
            this._curVerAppUsedCount = this.getCurVerAppUsedCount();
            this._isAppUsedBefore = this.checkAppUsedBefore();

            this.updateConfigValues();
            this.detectDarkTheme();

            this._configService.valueChanges.pipe(takeUntil(this._onDestroy)).subscribe(() => {
                this.updateConfigValues();
            });
        }

        this.checkUpdate();

        this._router.events
            .pipe(
                filter((event) => event instanceof NavigationEnd),
                map((event: NavigationEnd) => {
                    let child = this._activatedRoute.firstChild;
                    while (child && child.firstChild) {
                        child = child.firstChild;
                    }

                    if (!child) {
                        return {
                            pagePath: event.urlAfterRedirects,
                            pageType: undefined,
                            meta: undefined
                        };
                    }

                    return {
                        pagePath: event.urlAfterRedirects,
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                        pageType: child.snapshot.data.pageType,
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                        meta: child.snapshot.data.meta
                    };
                }),
                takeUntil(this._onDestroy)
            )
            .subscribe((routeData: { pagePath: string; pageType?: string; meta?: { [key: string]: string } }) => {
                this.isHomePage = routeData.pageType === 'home-page' ? true : false;
                this.updateMeta(routeData);

                if (routeData) {
                    this._pageClass = routeData.pageType;
                    this.updateComponentClass();
                }

                this._logger.trackPageView({
                    name: this._titleService.getTitle(),
                    uri: !this._isFirstNavigation && routeData.pagePath ? routeData.pagePath : undefined,
                    page_type: routeData.pageType ? routeData.pageType : undefined,
                    properties: {
                        app_version: appSettings.appVersion
                    }
                });

                if (!this._aboutPageNavigated && this._isBrowser && routeData.pageType === 'about-page') {
                    this._aboutPageNavigated = true;
                }

                if (
                    this._isBrowser &&
                    this.isHomePage &&
                    this._isFirstNavigation &&
                    this._curVerAppUsedCount === 0 &&
                    this._isAppUsedBefore
                ) {
                    this._isFirstNavigation = false;
                    this.increaseAppUsedCount();
                    this._hideSponsorSection = true;
                    void this._router.navigate(['/about'], { relativeTo: this._activatedRoute });
                } else if (
                    this._isBrowser &&
                    this.isHomePage &&
                    this._isFirstNavigation &&
                    this.shouldShowSocialSharingSheet()
                ) {
                    this._isFirstNavigation = false;
                    this.increaseAppUsedCount();
                    this._hideSponsorSection = true;
                    this._cacheService.setItem('socialSharingSheetShownIn', this._curVerAppUsedCount);
                    this._bottomSheet.open(SocialSharingSheetComponent);
                } else if (this._isFirstNavigation) {
                    this._isFirstNavigation = false;
                    this.increaseAppUsedCount();
                }
            });

        this.isScreenSmall = breakpointObserver
            .observe(`(max-width: ${SMALL_WIDTH_BREAKPOINT}px)`)
            .pipe(map((breakpoint) => breakpoint.matches));
    }

    ngOnInit(): void {
        // Do nothing
    }

    ngOnDestroy(): void {
        this._onDestroy.next();
        this._onDestroy.complete();

        this._logger.flush();
    }

    toggleSideNav(): void {
        if (!this.sidenav) {
            return;
        }

        void this.sidenav.toggle().then((drawerResult) => {
            this._logger.trackEvent({
                name: drawerResult === 'open' ? 'open_drawer_menu' : 'close_drawer_menu',
                properties: {
                    app_version: appSettings.appVersion,
                    app_platform: 'web'
                }
            });
        });
    }

    private updateMeta(routeData: { pagePath: string; pageType?: string; meta?: { [key: string]: string } }): void {
        const url = this._urlHelper.toAbsoluteUrl(routeData.pagePath);

        this._linkService.updateTag({
            rel: 'canonical',
            href: url
        });

        this._metaService.updateTag({
            property: 'og:url',
            content: url
        });

        const pageTitle = routeData.meta && routeData.meta.title ? routeData.meta.title : this.appTitleFull;
        this._titleService.setTitle(pageTitle);

        const socialTitle = routeData.meta && routeData.meta.socialTitle ? routeData.meta.socialTitle : pageTitle;
        this._metaService.updateTag({
            name: 'twitter:title',
            content: socialTitle
        });
        this._metaService.updateTag({
            property: 'og:title',
            content: socialTitle
        });

        if (routeData.meta && routeData.meta.noindex) {
            this._metaService.updateTag({
                name: 'robots',
                content: 'noindex'
            });
        } else {
            this._metaService.removeTag('name="robots"');
        }

        const metaDescription =
            routeData.meta && routeData.meta.description ? routeData.meta.description : appSettings.appDescription;
        this._metaService.updateTag({
            name: 'description',
            content: metaDescription
        });

        const socialDescription =
            routeData.meta && routeData.meta.socialDescription ? routeData.meta.socialDescription : metaDescription;
        this._metaService.updateTag({
            name: 'twitter:description',
            content: socialDescription
        });
        this._metaService.updateTag({
            property: 'og:description',
            content: socialDescription
        });

        const keywords = routeData.meta && routeData.meta.keywords ? routeData.meta.keywords : appSettings.appName;
        this._metaService.updateTag({
            name: 'keywords',
            content: keywords
        });
    }

    private checkUpdate(): void {
        if (!this._swUpdate.isEnabled) {
            return;
        }

        const appIsStable = this._appRef.isStable.pipe(first((isStable) => isStable === true));
        concat(appIsStable, interval(this._checkInterval))
            .pipe(takeUntil(this._onDestroy))
            .subscribe(() => {
                void this._swUpdate.checkForUpdate();
            });

        this._swUpdate.available.pipe(takeUntil(this._onDestroy)).subscribe((evt) => {
            const snackBarRef = this._snackBar.open('Update available.', 'RELOAD');
            snackBarRef.onAction().subscribe(() => {
                this._logger.trackEvent({
                    name: 'reload_update',
                    properties: {
                        app_version: appSettings.appVersion,
                        app_platform: 'web',
                        current_hash: evt.current.hash,
                        available_hash: evt.available.hash
                    }
                });

                void this._swUpdate.activateUpdate().then(() => {
                    document.location.reload();
                });
            });
        });
    }

    private updateComponentClass(): void {
        this.componentClass = '';
        if (this._pageClass) {
            this.componentClass += this._pageClass;
        }
        if (this._themeClass) {
            if (this.componentClass) {
                this.componentClass += ' ';
            }
            this.componentClass += this._themeClass;
        }
    }

    private detectDarkTheme(): void {
        let defaultValue = true;
        if (this._colorMode && this._colorMode.toLocaleLowerCase() === 'dark') {
            defaultValue = true;
        } else if (this._colorMode && this._colorMode.toLowerCase() === 'light') {
            defaultValue = false;
        } else {
            const cacheDarkModeStr = this._cacheService.getItem('isDarkMode');
            defaultValue = cacheDarkModeStr == null ? true : cacheDarkModeStr === 'true';
        }

        this.detectDarkThemeChange(defaultValue, true);
    }

    private detectDarkThemeChange(defaultValue: boolean, forceDefaultValue?: boolean): void {
        if (window.matchMedia('(prefers-color-scheme)').media !== 'not all') {
            const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            if (forceDefaultValue) {
                this.setDarkMode(defaultValue);
            } else {
                this.setDarkMode(darkModeMediaQuery.matches);
            }

            if (darkModeMediaQuery.addEventListener) {
                darkModeMediaQuery.addEventListener('change', (mediaQuery) => {
                    this.setDarkMode(mediaQuery.matches);
                });
            }
        } else {
            this.setDarkMode(defaultValue);
        }
    }

    private setDarkMode(value: boolean): void {
        this._isDarkMode = value;
        this._cacheService.setItem('isDarkMode', `${value}`.toLowerCase());
        this.toggleDarkTheme(value);
        this.updateComponentClass();
    }

    private toggleDarkTheme(isDark: boolean): void {
        this._themeClass = isDark ? 'dark' : '';
        this._overlayContainer.getContainerElement().classList.toggle('dark', isDark);
    }

    private getCurVerAppUsedCount(): number {
        const appUsedCountStr = this._cacheService.getItem<string>(`appUsedCount-v${appSettings.appVersion}`);
        if (appUsedCountStr) {
            return parseInt(appUsedCountStr, 10);
        }

        return 0;
    }

    private checkAppUsedBefore(): boolean {
        if (!this._isBrowser) {
            return false;
        }

        if (this._curVerAppUsedCount > 0) {
            return true;
        }

        const appUsed = this._cacheService.getItem<string>('appUsed');

        if (appUsed === 'true') {
            return true;
        }

        const oldVersions = [
            '3.3.3',
            '3.3.2',
            '3.3.1',
            '3.3.0',
            '3.2.0',
            '3.1.0',
            '3.0.0',
            '2.0.7',
            '2.0.6',
            '2.0.5',
            '2.0.4',
            '2.0.3',
            '2.0.2',
            '2.0.1',
            '2.0.0',
            '2.0.0-preview1',
            '1.1.5',
            '1.1.4',
            '1.1.3',
            '1.1.2',
            '1.1.1',
            '1.0.1',
            '1.0.0'
        ];

        for (const ver of oldVersions) {
            const str = this._cacheService.getItem<string>(`appUsedCount-v${ver}`);
            if (str) {
                return true;
            }
        }

        return false;
    }

    private increaseAppUsedCount(): void {
        if (!this._isBrowser) {
            return;
        }

        this._cacheService.setItem(`appUsedCount-v${appSettings.appVersion}`, `${this._curVerAppUsedCount + 1}`);

        if (!this._isAppUsedBefore) {
            this._cacheService.setItem('appUsed', 'true');
        }
    }

    private shouldShowSocialSharingSheet(): boolean {
        if (this._curVerAppUsedCount < 5 || typeof navigator !== 'object' || !navigator.onLine) {
            return false;
        }

        const socialSharingYesButtonPressed = this._cacheService.getItem<boolean>('socialSharingYesButtonPressed');
        if (socialSharingYesButtonPressed) {
            return false;
        }

        const socialSharingNoButtonPressed = this._cacheService.getItem<boolean>('socialSharingNoButtonPressed');
        if (socialSharingNoButtonPressed) {
            return false;
        }

        const socialSharingSheetShownIn = this._cacheService.getItem<number>('socialSharingSheetShownIn');

        if (socialSharingSheetShownIn && this._curVerAppUsedCount < socialSharingSheetShownIn + 7) {
            return false;
        }

        return true;
    }

    private updateConfigValues(): void {
        this._colorMode = this._configService.getValue('colorMode') as string;
        const sponsorSectionVisibleStr = this._configService.getValue('sponsorSectionVisible') as string;
        if (sponsorSectionVisibleStr && sponsorSectionVisibleStr.toLowerCase() === 'false') {
            this._hideSponsorSection = true;
        }

        const sponsorsStr = this._configService.getValue('sponsors') as string;
        if (sponsorsStr) {
            try {
                this.sponsors = JSON.parse(sponsorsStr) as Sponsor[];
            } catch (err) {
                this.sponsors = [];
            }
        }
    }
}
