/**
 * @license
 * Copyright DagonMetric. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found under the LICENSE file in the root directory of this source tree.
 */

import { Component, ViewEncapsulation } from '@angular/core';

import { MatSnackBar } from '@angular/material/snack-bar';

import { ConfigService } from '@dagonmetric/ng-config';
import { LogService } from '@dagonmetric/ng-log';

import { AppConfig } from '../shared/app-config';
import { NavLinkItem } from '../shared/nav-link-item';

/**
 * App about component.
 */
@Component({
    selector: 'app-about',
    templateUrl: './about.component.html',
    styleUrls: ['./about.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class AboutComponent {
    featureExpanded = false;

    get appName(): string | undefined {
        return this._appConfig.appName;
    }

    get appVersion(): string | undefined {
        return this._appConfig.appVersion;
    }

    get appDescription(): string | undefined {
        return this._appConfig.appDescription;
    }

    get navLinks(): NavLinkItem[] {
        return this._appConfig.navLinks;
    }

    private readonly _appConfig: AppConfig;

    constructor(
        private readonly _logService: LogService,
        private readonly _snackBar: MatSnackBar,
        configService: ConfigService) {
        this._appConfig = configService.getValue<AppConfig>('app');
    }

    expandFeatures(): void {
        this.featureExpanded = true;
    }

    openSharing(): void {
        this._appConfig.socialSharing = this._appConfig.socialSharing || {};

        const socialSharingSubject = this._appConfig.socialSharing.subject;
        const socialSharingLink = this._appConfig.socialSharing.linkUrl;
        const socialSharingMessage = this._appConfig.socialSharing.message;

        // tslint:disable-next-line: no-any
        if (typeof navigator === 'object' && (navigator as any).share) {
            // tslint:disable-next-line: no-any no-unsafe-any
            (navigator as any).share({
                title: socialSharingSubject,
                text: socialSharingMessage,
                url: socialSharingLink
            }).then(() => {
                this._logService.trackEvent({
                    name: 'share',
                    properties: {
                        method: 'Web Share API',
                        app_version: this._appConfig.appVersion
                    }
                });
                this.showThankYouMessage();
            }).catch((err: Error) => {
                const errMsg = err && err.message ? ` ${err.message}` : '';
                this._logService.error(`An error occurs when sharing via Web API.${errMsg}`, {
                    properties: {
                        app_version: this._appConfig.appVersion
                    }
                });

                this.shareTofacebook();
            });
        } else {
            this.shareTofacebook();
        }
    }

    private shareTofacebook(): void {
        this._appConfig.socialSharing = this._appConfig.socialSharing || {};

        const appId = this._appConfig.facebookAppId || '';
        const socialSharingLink = this._appConfig.socialSharing.linkUrl || '';
        const socialSharingMessage = this._appConfig.socialSharing.message || '';

        let urlString = 'https://www.facebook.com/dialog/share?';
        urlString += `&app_id=${encodeURIComponent(appId)}`;
        // urlString += `&redirect_uri=${encodeURIComponent(socialSharingLink)}`;
        urlString += `&href=${encodeURIComponent(socialSharingLink)}`;
        urlString += `&quote=${encodeURIComponent(socialSharingMessage)}`;
        // urlString += `&display=${encodeURIComponent('popup')}`;

        const winWidth = 557;
        const winHeight = 690;
        const winTop = (window.innerHeight - winHeight) / 2; // (screen.height / 2) - (winHeight / 2);
        const winLeft = (window.innerWidth - winWidth) / 2; // (screen.width / 2) - (winWidth / 2);

        window.open(
            urlString,
            'Facebook',
            `toolbar=0,status=0,resizable=yes,width=${winWidth},height=${winHeight},top=${winTop},left=${winLeft}`);

        this._logService.trackEvent({
            name: 'share',
            properties: {
                method: 'Facebook Share Dialog',
                app_version: this._appConfig.appVersion
            }
        });

        this.showThankYouMessage();
    }

    private showThankYouMessage(): void {
        this._snackBar.open('Thank you for sharing 😄.', undefined, {
            duration: 3000
        });
    }
}
