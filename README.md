# 문장 사이
Node.js 20 이상에서 start.cmd를 실행하거나 이 디렉터리에서 npm start를 실행하세요. http://localhost:4284 에서 방을 열 수 있습니다. 같은 Wi-Fi의 친구와 사용할 때는 방장도 PC의 LAN IP와 4284 포트로 접속한 뒤 초대 링크를 복사하세요. Windows 방화벽에서 개인 네트워크 접근을 허용해야 할 수 있습니다. 서버가 실행되는 동안 참여할 수 있고 원고는 .data에 저장됩니다.

## Vercel과 Supabase
이 디렉터리의 소스를 GitHub 저장소에 올리고 Vercel로 가져옵니다. 프레임워크는 Other, 정적 출력 디렉터리는 public입니다. api/room.js가 서버 함수로 실행됩니다. 새 Supabase 프로젝트의 SQL Editor에서 schema.sql을 한 번 실행한 뒤 Vercel 서버 환경 변수 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정하고 배포하세요. 서비스 키는 서버에만 보관합니다. 로컬 파일 저장소와 배포용 데이터베이스는 별개입니다.

방장은 제목과 첫 문단을 쓰고 친구를 초대합니다. 두 명 이상 모이면 시작할 수 있습니다. 첫 문단을 쓴 방장 다음으로 두 번째 참여자가 이어 씁니다. 시작한 뒤에는 참여 순서가 고정됩니다. 필명과 참여 권한은 접속한 브라우저에 연결됩니다.


현재 배포본은 서울 리전의 비공개 Vercel Blob에 원고를 저장합니다. 프로젝트에 연결한 BLOB_READ_WRITE_TOKEN이 있으면 이 저장소를 우선 사용합니다.
