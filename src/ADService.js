/* eslint-disable camelcase */
import { RequestType } from './Constants';
import Result from './Result';

class ADService {
  init = props => {
    this.tenant = props.tenant;
    this.appId = props.appId;
    this.loginPolicy = props.loginPolicy;
    this.loginHint = props.loginHint;
    this.responseType = props.responseType;
    this.passwordResetPolicy = props.passwordResetPolicy;
    this.profileEditPolicy = props.profileEditPolicy;
    this.redirectURI = props.redirectURI ? encodeURI(props.redirectURI) : null;
    this.context = props.context;
    this.scope = props.scope ? encodeURI(props.scope) : null;
    this.response_mode = 'query';
    this.tokenResult = {};
    this.secureStore = props.secureStore;
    this.baseUri = `https://${this.tenant}.b2clogin.com/${this.tenant}.onmicrosoft.com`;
    this.language = props.language

    this.TokenTypeKey = 'tokenType';
    this.AccessTokenKey = 'accessToken';
    this.IdTokenKey = 'idToken';
    this.RefreshTokenKey = 'refreshToken';
    this.ExpiresOnKey = 'expiresOn';
  };

  logoutAsync = async () => {
    this.tokenResult = {};
    await Promise.all([
      this.secureStore.deleteItemAsync(this.TokenTypeKey),
      this.secureStore.deleteItemAsync(this.AccessTokenKey),
      this.secureStore.deleteItemAsync(this.IdTokenKey),
      this.secureStore.deleteItemAsync(this.RefreshTokenKey),
      this.secureStore.deleteItemAsync(this.ExpiresOnKey),
    ]);
  };

  isAuthenticAsync = async () => {
    const [
      tokenType,
      accessToken,
      refreshToken,
      idToken,
      expiresOn,
    ] = await Promise.all([
      this.secureStore.getItemAsync(this.TokenTypeKey),
      this.secureStore.getItemAsync(this.AccessTokenKey),
      this.secureStore.getItemAsync(this.RefreshTokenKey),
      this.secureStore.getItemAsync(this.IdTokenKey),
      this.secureStore.getItemAsync(this.ExpiresOnKey),
    ]);

    this.tokenResult = {
      tokenType,
      accessToken,
      idToken,
      refreshToken,
      expiresOn: parseInt(expiresOn),
    };

    return this._isTokenValid(this.tokenResult);
  };

  _isTokenValid = tokenResult =>
    tokenResult && new Date().getTime() < tokenResult.expiresOn * 1000;

  getAccessTokenAsync = async () => {
    if (!this._isTokenValid(this.tokenResult)) {
      const result = await this.fetchAndSetTokenAsync(
        this.tokenResult.refreshToken,
        this.loginPolicy,
        true
      );

      if (!result.isValid) {
        return result;
      }
    }

    return Result(
      true,
      `${this.tokenResult.tokenType} ${this.tokenResult.accessToken}`,
    );
  };

  getIdToken = () => this.tokenResult.idToken;

  fetchAndSetTokenAsync = async (authCode, policy, isRefreshTokenGrant) => {
    if (!authCode) {
      return Result(false, 'Empty auth code');
    }

    try {
      let params = {
        client_id: this.appId,
        scope: `${this.appId} offline_access`,
        redirect_uri: this.redirectURI,
      };

      if(isRefreshTokenGrant){
        params.grant_type = 'refresh_token';
        params.refresh_token = authCode;
      }else{
        // params.grant_type = 'authorization_code';
        params.code= authCode;
      }

      const body = this.getFormUrlEncoded(params);
      const url = this._getStaticURI(policy, 'token');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error_description);
      }
      await this._setTokenDataAsync(response);
      return Result(true);
    } catch (error) {
      return Result(false, error.message);
    }
  };

  getRefreshToken = async (code, grantType, baseUrl, appId, scope, redirectURI) => {
    const url = this._getStaticURI(this.loginPolicy, 'token', code, grantType, baseUrl, appId, scope, redirectURI);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      const res = await response.json();
      return res
    } catch (e) {
      console.log('error getRefreshToken', e)
    }
  }

  _setTokenDataAsync = async response => {
    const res = await response.json();
    this.tokenResult = {
      tokenType: res.token_type,
      accessToken: res.access_token,
      idToken: res.id_token,
      refreshToken: res.refresh_token,
      expiresOn: res.expires_on,
    };

    await Promise.all(
      this.secureStore.setItemAsync(this.TokenTypeKey, res.token_type),
      this.secureStore.setItemAsync(this.AccessTokenKey, res.access_token),
      this.secureStore.setItemAsync(this.RefreshTokenKey, res.refresh_token),
      this.secureStore.setItemAsync(this.IdTokenKey, res.id_token),
      this.secureStore.setItemAsync(
        this.ExpiresOnKey,
        res.expires_on ? res.expires_on.toString() : '',
      ),
    );
  };

  getFormUrlEncoded = params =>
    Object.keys(params)
      .map(
        key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`,
      )
      .join('&');

  _getStaticURI = (policy, endPoint, code, grantType, baseUrl, appId, scope, redirectURI) => {
    let uri = baseUrl ? baseUrl : `${this.baseUri}/oauth2/v2.0/${endPoint}?p=${policy}&`;
    if (endPoint === 'authorize') {
      uri += `client_id=${this.appId}`;
      uri += `&response_type=${this.responseType}`
      uri += `&redirect_uri=${this.redirectURI}`;
      uri += `&scope=${this.scope}`;
      uri += '&nonce=defaultNonce';
      uri += `&context=${this.context}`
      if (this.loginHint) {
        uri +=`&login_hint=${this.loginHint}`;
      }
      if (this.language) {
        uri +=`&ui_locales=${this.language}`;
      }
    } else if (endPoint === 'token' && grantType && code) {
      uri += `grant_type=${grantType}`;
      uri += `&client_id=${this.appId || appId}`;
      uri += `&scope=${this.scope || scope}`;
      uri += `&redirect_uri=${this.redirectURI || redirectURI}`;
      if (grantType === 'refresh_token') {
        uri += `&refresh_token=${code}`
      } else if (grantType === 'authorization_code') {
        uri += `&code=${code}`;
      }
    }
    return uri;
  };

  getLoginURI = () => this._getStaticURI(this.loginPolicy, 'authorize');

  getLogoutURI = () =>
    `${this.baseUri}/${this.loginPolicy}/oauth2/v2.0/logout?post_logout_redirect_uri=${this.redirectURI}`;

  getPasswordResetURI = () =>
    `${this._getStaticURI(this.passwordResetPolicy, 'authorize')}`;

  getProfileEditURI = () =>
    `${this._getStaticURI(this.profileEditPolicy, 'authorize')}`;

  getLoginFlowResult = url => {
    const params = this._getQueryParams(url);
    const { error_description, code } = params;

    let data = '';
    if (code) {
      data = code;
    } else {
      data = error_description;
    }

    return {
      requestType: this._getRequestType(url, params),
      data,
    };
  };

  _getRequestType = (
    url,
    { error_description, code, post_logout_redirect_uri },
  ) => {
    if (code) {
      return RequestType.Code;
    }

    if (post_logout_redirect_uri === this.redirectURI) {
      return RequestType.Logout;
    }
    if (error_description) {
      if (error_description.indexOf('AADB2C90118') !== -1) {
        return RequestType.PasswordReset;
      }

      if (error_description.indexOf('AADB2C90091') !== -1) {
        return RequestType.Cancelled;
      }
    }

    // always keep this check last
    if (url.indexOf(this.redirectURI) === 0) {
      return RequestType.Ignore;
    }

    return RequestType.Other;
  };

  _getQueryParams = url => {
    const regex = /[?(&|#)]([^=#]+)=([^&#]*)/g;
    const params = {};
    let match;
    while ((match = regex.exec(url))) {
      params[match[1]] = match[2];
    }
    return params;
  };
}

const adService = new ADService();
export default adService;
export { ADService };
