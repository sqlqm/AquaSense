import { Authorization } from "../authorization.js";
import { Database } from "../database.js";
import { PathLock } from "../path_lock.js";
import { DeviceManager } from "../device_manager.js";

export function initialize(app) {
  app.post("/upload_image", async (req, res) => {
    // check sensor authorization
    if (!Authorization.request_has_sensor_device_authorization(req)) {
      res.send({ success: false, error: "unauthorized" });
      return;
    }

    // check if image data is provided
    let image_data = req.body.image;
    if (!image_data) {
      res.send({ success: false, error: "missing image" });
      return;
    }

    // check if content type is provided
    let content_type = req.body.content_type || "image/jpeg";

    // get the device id from the request
    let device_id = Authorization.get_device_id_from_request(req);

    // use timestamp as the image filename to keep images unique and ordered
    let timestamp = Math.floor(Date.now() / 1000);
    let image_path = "devices/" + device_id + "/images/" + timestamp + ".jpg";
    let index_path = "devices/" + device_id + "/images/index.json";

    // lock the index path to prevent concurrent writes
    await PathLock.lock_paths([index_path]);
    function send_response(response) {
      PathLock.unlock_paths([index_path]);
      res.send(response);
    }

    try {
      // decode the base64 image data
      let image_buffer = Buffer.from(image_data, "base64");

      // upload the image to the database
      let upload_success = await Database.upload_binary(
        image_path,
        image_buffer,
        content_type
      );
      if (!upload_success) {
        send_response({ success: false, error: "failed to upload image" });
        return;
      }

      // update the image index so the app can list all images for a device
      let index_result = await Database.read_text(index_path, "{}");
      if (!index_result.success) {
        send_response({ success: false, error: "failed to read image index" });
        return;
      }
      let index = JSON.parse(index_result.text);
      if (!index.images) {
        index.images = [];
      }
      index.images.push({
        path: image_path,
        time: timestamp,
        upload_time: Date.now() / 1000,
      });
      index.last_updated = Date.now() / 1000;

      let index_success = await Database.upload_text(
        index_path,
        JSON.stringify(index)
      );
      if (!index_success) {
        send_response({
          success: false,
          error: "failed to update image index",
        });
        return;
      }

      send_response({ success: true, path: image_path, time: timestamp });
    } catch (e) {
      send_response({ success: false, error: "internal error: " + e });
    }
  });
}
