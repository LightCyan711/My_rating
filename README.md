My Ratings - 개인 평점 사이트

이 저장소는 개인적으로 게임/애니/영화 평점을 관리하기 위한 정적 사이트입니다.

빠른 시작
1. Firebase 콘솔에서 새 프로젝트 생성.
2. Authentication -> Sign-in method에서 "Google" 활성화.
3. Firestore 생성(테스트 모드 후 규칙 변경 권장).
4. `firebase-config.js`의 값을 Firebase 설정으로 교체하고 `ADMIN_EMAIL`에 본인 이메일을 적어주세요.
5. Firestore 보안 규칙 예시(콘솔 -> Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ratings/{doc} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.token.email == "you@example.com";
    }
  }
}
```

(위의 `you@example.com`을 본인 이메일로 바꿔야 합니다.)

로컬 테스트
```powershell
# 윈도우에서 간단히
python -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

이미지(포스터) 사용 안내
- 이미지 파일을 로컬 프로젝트 폴더 내 `images/` 디렉터리에 넣고 숫자 파일명으로 저장하세요. 예: `images/1.jpg`, `images/2.jpg` 등.
- 에디터의 `포스터 번호`에 파일명 숫자(확장자 제외)만 입력하면 해당 이미지가 카드에 표시됩니다.
- 초기 구현은 로컬 프로젝트 내 이미지를 사용하므로 GitHub Pages에 올려 배포하는 경우 이미지도 함께 커밋/푸시하세요.

배포
- GitHub Pages로 배포하려면 저장소를 푸시하고 `main` 브랜치에 위 워크플로가 동작하게 합니다.

도움이 필요하면 Firebase 콘솔 설정 단계까지 제가 도와드릴게요.
