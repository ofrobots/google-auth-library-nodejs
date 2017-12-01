/**
 * Copyright 2013 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {AxiosError, AxiosPromise, AxiosRequestConfig, AxiosResponse} from 'axios';

import {RequestError} from './../transporters';
import {CredentialRequest, Credentials} from './credentials';
import {GetTokenResponse, OAuth2Client} from './oauth2client';

export class Compute extends OAuth2Client {
  /**
   * Google Compute Engine metadata server token endpoint.
   */
  protected static readonly _GOOGLE_OAUTH2_TOKEN_URL =
      'http://metadata.google.internal/computeMetadata/v1beta1/instance/service-accounts/default/token';

  /**
   * Google Compute Engine service account credentials.
   *
   * Retrieve access token from the metadata server.
   * See: https://developers.google.com/compute/docs/authentication
   */
  constructor() {
    super();
    // Start with an expired refresh token, which will automatically be
    // refreshed before the first API call is made.
    this.credentials = {expiry_date: 1, refresh_token: 'compute-placeholder'};
  }

  /**
   * Indicates whether the credential requires scopes to be created by calling
   * createdScoped before use.
   * @return Boolean indicating if scope is required.
   */
  createScopedRequired() {
    // On compute engine, scopes are specified at the compute instance's
    // creation time, and cannot be changed. For this reason, always return
    // false.
    return false;
  }

  /**
   * Refreshes the access token.
   * @param refreshToken Unused parameter
   */
  protected async refreshToken(refreshToken?: string|
                               null): Promise<GetTokenResponse> {
    const url = this.opts.tokenUrl || Compute._GOOGLE_OAUTH2_TOKEN_URL;
    let res: AxiosResponse<CredentialRequest>|null = null;
    // request for new token
    try {
      res = await this.transporter.request<CredentialRequest>({url});
    } catch (e) {
      e.message = 'Could not refresh access token.';
      throw e;
    }
    console.log(res.data);
    const tokens = res.data as Credentials;
    if (res.data && res.data.expires_in) {
      tokens.expiry_date =
          ((new Date()).getTime() + (res.data.expires_in * 1000));
      delete (tokens as CredentialRequest).expires_in;
    }
    return {tokens, res};
  }


  protected requestAsync<T>(opts: AxiosRequestConfig, retry = false):
      AxiosPromise<T> {
    return super.requestAsync<T>(opts, retry).catch(e => {
      const res = (e as AxiosError).response;
      if (res && res.status) {
        let helpfulMessage = null;
        if (res.status === 403) {
          helpfulMessage =
              'A Forbidden error was returned while attempting to retrieve an access ' +
              'token for the Compute Engine built-in service account. This may be because the Compute ' +
              'Engine instance does not have the correct permission scopes specified.';
        } else if (res.status === 404) {
          helpfulMessage =
              'A Not Found error was returned while attempting to retrieve an access' +
              'token for the Compute Engine built-in service account. This may be because the Compute ' +
              'Engine instance does not have any permission scopes specified.';
        }
        if (helpfulMessage) {
          if (e && e.message && !retry) {
            helpfulMessage += ' ' + e.message;
          }
          if (e) {
            e.message = helpfulMessage;
          } else {
            e = new Error(helpfulMessage);
            (e as RequestError).code = res.status.toString();
          }
        }
      }
      throw e;
    });
  }
}
