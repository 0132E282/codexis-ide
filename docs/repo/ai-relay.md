# Testcase repo: chuyển lượt giữa các AI

Trạng thái chạy: **Not Run** (chưa chạy bộ này). Cần `claude` và `codex` đã đăng nhập, chạy `pnpm start`.

| ID    | Bước                                                      | Kết quả mong đợi                                                                                      | Trạng thái |
| ----- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| AR-01 | Chọn Claude, nhờ "hỏi codex xem 2+2 bằng mấy rồi báo lại" | Timeline có nhãn Codex rồi nhãn Claude; Claude tổng kết; chỉ một lần kết thúc lượt                    | Not Run    |
| AR-02 | Trong lúc hop của Codex đang chạy, bấm Dừng (hoặc Ctrl+C) | Cả relay dừng, không hop mới; lượt kết thúc không báo lỗi                                             | Not Run    |
| AR-03 | Bấm Dừng ngay giữa hai hop                                | Không có hop nào bắt đầu sau đó                                                                       | Not Run    |
| AR-04 | Ép hai AI nhờ nhau liên tục bằng tin khác nhau            | Dừng sau 6 hop với thông báo "đủ số lần cho phép"                                                     | Not Run    |
| AR-05 | Ép một AI nhắc `relay:` tới chính nó                      | Dừng, thông báo "gửi tin cho chính nó"                                                                | Not Run    |
| AR-06 | Ép AI gửi `relay:gemini`                                  | Dừng, thông báo AI không dùng được                                                                    | Not Run    |
| AR-07 | Sau relay, gửi tiếp tin nhắn ở cuộc trò chuyện            | Phiên của AI chat vẫn là phiên cũ (không bị phiên của AI kia ghi đè); mở lại cuộc trò chuyện giữ nhãn | Not Run    |
| AR-08 | Dùng side chat                                            | Không có relay                                                                                        | Not Run    |
