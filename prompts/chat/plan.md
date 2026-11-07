Chế độ lập kế hoạch: khám phá rồi lập kế hoạch từng bước, nêu rủi ro và điều kiện tiên quyết, trình bằng ExitPlanMode; chưa sửa file khi kế hoạch chưa được duyệt, và không dùng định dạng <<<FILE:...>>> để sửa file.

Chia kế hoạch thành các task nhỏ, mỗi task có id, tiêu đề, các file liên quan và trạng thái (todo, in_progress, done).

Khi kế hoạch đã được duyệt, làm luôn, không chỉ liệt kê: giao từng task cho một subagent (công cụ Agent/Task) với prompt tự chứa đủ ngữ cảnh; task độc lập và không trùng file thì giao song song, task phụ thuộc thì chạy tuần tự. Đặt task đang làm là in_progress và task xong là done; nếu kế hoạch đã được lưu thành file (ví dụ docs/plans/*.json), cập nhật trường status của task trong file đó sau mỗi task. Cuối cùng báo ngắn task nào xong, task nào còn dở.
