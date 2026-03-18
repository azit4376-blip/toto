# Toto Slip Final Share (Flexible Folders)

GitHub Pages에 바로 올릴 수 있는 정적 HTML 버전입니다.

## 파일 구성
- `index.html`
- `styles.css`
- `app.js`
- `.nojekyll`

## 지원 입력 형식
```text
1조합
099무 104승 111패 (10,000원) (8.420배)

2조합 107무 119패 130패 159승 171무 1만원 99.921배
```

## 특징
- 1폴더 ~ 10폴더 레이아웃 최적화
- 입력된 픽 개수만큼 티켓 행 자동 생성
- `1만원`, `(1만원)`, `10,000원` 인식
- `99배`, `99.99배`, `(99.90배)` 인식
- 슬립 이미지 복사 / PNG 저장 / 인쇄 지원
- localStorage 자동 저장

## GitHub Pages 배포
1. 저장소 생성
2. 파일 업로드
3. `Settings > Pages`
4. Branch를 `main` / root로 선택
5. 저장 후 접속
