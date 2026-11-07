# Testcase repo: session rail

Trạng thái chạy: **Not Run** (chưa chạy bộ này).

| ID    | Bước                                                          | Kết quả mong đợi                                                                                            | Trạng thái |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| SR-01 | Bấm nút "Show session rail" ở thanh công cụ                   | Ngăn mở bên phải; nút đổi thành "Hide session rail" và `aria-pressed`                                       | Not Run    |
| SR-02 | Mở menu `...`                                                 | Dòng "Session rail" có dấu ✓ khi ngăn đang mở                                                               | Not Run    |
| SR-03 | Xem khối Environment                                          | Tên dự án, thư mục dạng `~/...`, nhánh git; bánh răng mở Cài đặt                                            | Not Run    |
| SR-04 | Bật công tắc Remote Control, đóng hộp thoại ghép, mở lại      | Bật mở hộp thoại QR; công tắc phản ánh `remote_status`; tắt gọi `remote_stop`                               | Not Run    |
| SR-05 | Gửi một lượt chat, xem khối Context                           | "N% used", thanh nhiều đoạn, `used / window`; không có Auto-compact, không có phân loại Messages/MCP/Skills | Not Run    |
| SR-06 | Có `.mcp.json` với 2 server                                   | Khối Connectors liệt kê 2 server, trạng thái "cấu hình", không có nút Authenticate                          | Not Run    |
| SR-07 | AI ghi/sửa 2 tệp (một tệp sửa hai lần); bấm tệp trong Outputs | Hiện mỗi tệp một lần, mới nhất trước; bấm mở trong editor                                                   | Not Run    |
| SR-08 | Dự án có origin GitHub và PR đang mở cho nhánh                | GitHub hiện tài khoản, repo, nhánh, PR                                                                      | Not Run    |
| SR-09 | `gh` chưa đăng nhập / không có origin GitHub / không có `gh`  | Hiện trạng thái tương ứng hoặc ẩn khối; các khối khác vẫn hoạt động                                         | Not Run    |
| SR-10 | Đổi vị trí ngăn qua menu Move, tải lại                        | Vị trí được nhớ (`ide.placement.session-rail`)                                                              | Not Run    |
