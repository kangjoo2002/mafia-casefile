# Auth

## 회원가입 API

`POST /auth/signup`

- 요청: `email`, `nickname`, `password`
- 응답: `user`와 `accessToken`

## 로그인 API

`POST /auth/login`

- 요청: `email`, `password`
- 응답: `user`와 `accessToken`

## 비밀번호 저장 정책

비밀번호는 평문으로 저장하지 않는다. `bcryptjs`로 해시한 값만 PostgreSQL `users.passwordHash`에 저장한다.

## JWT payload

access token payload는 최소 다음 필드를 포함한다.

```json
{
  "sub": "userId",
  "email": "user@example.com"
}
```

만료 시간은 `1h`다.

## JWT_SECRET

JWT 서명에는 `JWT_SECRET` 환경변수를 사용한다. 값이 없으면 로컬 개발용 기본값을 사용한다.

## 주요 에러 정책

- 회원가입: 필수 값이 비어 있으면 `400 Bad Request`
- 회원가입: 중복 이메일이면 `409 Conflict`
- 로그인: 사용자가 없거나 비밀번호가 틀리면 `401 Unauthorized`

## Socket.IO 인증

Socket.IO 연결 시 `auth.token`에 accessToken을 전달한다.

JWT payload의 `sub`는 `userId` 기준이며, 서버는 인증 성공 시 `socket.data.user`에 아래 형태를 저장한다.

```json
{
  "id": "userId",
  "email": "user@example.com"
}
```

토큰이 없거나 잘못된 경우 연결은 실패한다.
